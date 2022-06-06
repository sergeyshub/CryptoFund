import dotenv from 'dotenv';
dotenv.config();  // must be before 'import config...'
import config from 'config';
import { ethers } from 'ethers';
import cron from 'cron';

import * as Utils from './Utils';
import * as log from './Log';
import { db, DbConnection, Data, ExecuteResult } from './Database';
import CronLib from './CronLib';
import * as BlockLib from './BlockLib';
import Asset from './models/Asset';

export default class Synchronizer {
    private static cronJob: cron.CronJob;
    private static eventDc: DbConnection;

    public static async start() {
        this.eventDc = await db.getConnection();

        await this.getTransactions();

        await this.listenToTransactions();

        const minutes = config.get<number>('blockchain.intervalEvents');

        this.cronJob = new cron.CronJob(CronLib.makeCronString(minutes), async () => {
            await this.getTransactions();
        });

        this.cronJob.start();

        log.info(`Synchronizer started`);
    }

    public static stop() {
        this.cronJob.stop();
    }

    private static async listenToTransactions(): Promise<void> {
        try {
            const [funds, ] = await this.eventDc.query<Data[]>('SELECT * FROM Fund WHERE Status = 1 ORDER BY Id');
    
            for (var i = 0; i < funds.length; i++) {
                const fundContract = new ethers.Contract(funds[i].Address, BlockLib.fundAbi, BlockLib.rpcs[funds[i].NetworkId]);

                fundContract.on('Transacted', (assetAddress, amount, user, event) => {
                    this.saveTransactionEvent(this.eventDc, event);
                });
            }
        } catch (error) {
            console.error(error);
        }
    }

    private static async saveTransactionEvent(dc: DbConnection, event: ethers.Event): Promise<void> {
        try {
            const [rows, ] = await dc.query<Data[]>('SELECT * FROM Fund WHERE Address = ?', event.address);
            if (rows.length == 0) throw new Error(`Could not find fund address '${event.address}'`);
            const fund = rows[0];

            const fundSynchronizer = await FundSynchronizer.create(dc, fund);
            await fundSynchronizer.saveTransactionEvent(event);
        } catch (error) {
            console.error(error);
        }
    }

    private static async getTransactions(): Promise<void> {
        try {
            const dc = await db.getConnection();

            const [funds, ] = await dc.query<Data[]>('SELECT * FROM Fund WHERE Status = 1 ORDER BY Id');

            for (var i = 0; i < funds.length; i++) {
                const fundSynchronizer = await FundSynchronizer.create(dc, funds[i]);
                await fundSynchronizer.synchronize();
            }

            dc.release();
        } catch (error) {
            console.error(error);
        }
    }
}

class FundSynchronizer {
    private dc: DbConnection;
    private fundId: number;
    private fundTicker: string;
    private fundAddress: string;
    private networkId: number;
    private fundContract: ethers.Contract;
    private assetDict: BlockLib.AssetDictionary;
    private assetAddrDict: BlockLib.AssetAddressDictionary;
    private assetBtc: Asset;
    private assetEth: Asset;

    private lastBlockNumber: number = 0;
    private lastBlockTime: Date = undefined;
    private lastPriceBtc: number = undefined;
    private lastPriceEth: number = undefined;

    public static async create(dc: DbConnection, fund: Data): Promise<FundSynchronizer> {
        const fundSynchronizer = new FundSynchronizer();
        await fundSynchronizer.setup(dc, fund);
        return fundSynchronizer;
    }

    public async synchronize(): Promise<void> {
        const [networks, ] = await this.dc.query<Data[]>('SELECT * FROM Network WHERE Id = ?', [this.networkId]);
        if (networks.length == 0 || networks[0].SyncBlock == null) throw new Error(`SyncBlock is null for network Id ${this.networkId}`);
        var startBlock = networks[0].SyncBlock + 1;

        const blockStep = config.get<number>('blockchain.blockStep');

        await this.synchronizeEvents(startBlock, blockStep);
    }

    public async saveTransactionEvent(event: ethers.Event) {
        // console.log(event);

        await this.updateTimeAndPrices(event.blockNumber);

        var userAddress: string = event.args?.user;
        if (userAddress == undefined) throw new Error(`userAddress is not set in event`);

        var assetAddress = event.args?.assetAddress;
        if (assetAddress == undefined) throw new Error(`assetAddress is not set in event`);

        var amountBig = event.args?.amount;
        if (amountBig == undefined) throw new Error(`amount is not set in event`);

        var txHash = event.transactionHash;
        if (txHash == undefined) throw new Error(`transactionHash is not set in event`);

        var assetId = this.assetAddrDict[assetAddress]?.id;
        if (assetId == undefined) throw new Error(`Asset address not in the dictionary '${assetAddress}'`);

        // Note that Ethers (not the rounding function) returns amount = 0 when the amount is below the smallest decimal number, e.g. 0.000000009 for BTC
        const decimals = this.assetAddrDict[assetAddress].decimals;
        const amount = BlockLib.bigToNormal(amountBig, decimals);

        var userId = await this.addOrFindUserId(userAddress);

        var asset = new Asset(this.assetDict[assetId]?.asset);
        var priceUsd = await asset?.getPrice(this.dc, this.lastBlockTime);

        await this.addTransaction(asset, userId, amount, amountUsd, amountBtc, amountEth, txHash);
    }

    private async addOrFindUserId(userAddress: string): Promise<number> {
        // This is to avoid auto incrementing Id when a record already exist
        var [rows, ] = await this.dc.query<Data[]>('SELECT Id FROM User WHERE Address = ?', userAddress);
        if (0 < rows.length) return rows[0].Id;
        
        var userId: number;

        var query = 'INSERT IGNORE INTO User (Address, TimeAdded) VALUES (?, ?)';
        var [result, ] = await this.dc.query<ExecuteResult>(query, [userAddress, this.lastBlockTime]);

        return userId;
    }

    private async addTransaction(asset: Asset, userId: number, amount: number, amountUsd: number, amountBtc: number, amountEth: number, txHash: string): Promise<void> {
        var [rows, ] = await this.dc.query<Data[]>('SELECT Id FROM Transaction WHERE FundId = ? AND AssetId = ? AND UserId = ? AND Amount = ? AND TxHash = ?', 
            [this.fundId, asset.id, userId, amount, txHash]);
        if (0 < rows.length) return;

        var query = 'INSERT IGNORE INTO Transaction (FundId, AssetId, UserId, Amount, AmountUsd, AmountBtc, AmountEth, TxHash, Timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
        var [result, ] = await this.dc.query<ExecuteResult>(query, [this.fundId, asset.id, userId, amount, amountUsd, amountBtc, amountEth, txHash, this.lastBlockTime]);
        if (result.insertId == 0) return;

        log.info(`Found tx: fund ${this.fundTicker}, user id ${userId}, for ${Utils.numberToString(amount, 8)} ${asset.ticker}, id ${result.insertId}`);
    }

    private async setup(dc: DbConnection, fund: Data): Promise<void> {
        this.dc = dc;

        this.fundId = fund.Id;
        this.fundTicker = fund.Ticker;
        this.fundAddress = fund.Address;
        this.networkId = fund.NetworkId;
        this.fundContract = new ethers.Contract(this.fundAddress, BlockLib.fundAbi, BlockLib.rpcs[this.networkId]);

        this.assetDict = await BlockLib.getAssetDictionary(dc, this.fundId);
        this.assetAddrDict = await BlockLib.getAssetAddressDictionary(dc, this.networkId);

        var [rows, ] = await this.dc.query<Data[]>('SELECT * FROM Asset WHERE Ticker = \'BTC\'');
        if (rows.length == 0) throw new Error(`Could not find asset BTC`);
        this.assetBtc = new Asset(rows[0]);

        [rows, ] = await this.dc.query<Data[]>('SELECT * FROM Asset WHERE Ticker = \'ETH\'');
        if (rows.length == 0) throw new Error(`Could not find asset ETH`);
        this.assetEth = new Asset(rows[0]);
    }

    private async synchronizeEvents(startBlock: number, blockStep: number) {
        // log.info(`Synching fund ${this.fundTicker}`);

        var currentBlockNumber: number;

        do {
            currentBlockNumber = await BlockLib.getCurrentBlock(this.networkId);

            if (currentBlockNumber < startBlock) break;

            var finishBlock = Math.min(startBlock + blockStep, currentBlockNumber);

            await this.getTransactionEvents(startBlock, finishBlock);

            await this.dc.query('UPDATE Network Set SyncBlock = ? WHERE Id = ?', [finishBlock, this.networkId]);

            startBlock = finishBlock + 1;
        } while (true);

        // log.info(`All synched.`);
    }

    private async getTransactionEvents(fromBlock: number, toBlock: number) {
        log.info(`Blocks ${fromBlock} - ${toBlock}`);

        const filter = this.fundContract.filters.Transacted();
        const events = await this.fundContract.queryFilter(filter, fromBlock, toBlock);

        for (var i = 0; i < events.length; i++) await this.saveTransactionEvent(events[i]);
    }

    private async updateTimeAndPrices(blockNumber: number) {
        if (blockNumber == this.lastBlockNumber) return;

        this.lastBlockNumber = blockNumber;

        var block = await BlockLib.rpcs[this.networkId].getBlock(this.lastBlockNumber);
        var timestamp = block.timestamp;
        this.lastBlockTime = new Date(timestamp * 1000);

        this.lastPriceBtc = await this.assetBtc?.getPrice(this.dc, this.lastBlockTime);
        this.lastPriceEth = await this.assetEth?.getPrice(this.dc, this.lastBlockTime);
    }

    // Ethers doesn't support multiple events per filter. This routine can merge different events by block number.
    private mergeEvents(events1: Array<ethers.Event>, events2: Array<ethers.Event>): Array<ethers.Event> {
        var events = new Array<ethers.Event>(events1.length + events2.length);

        var i1 = 0;
        var i2 = 0;

        for (var i = 0; i < events.length; i++) {
            if (i1 == events1.length) events[i] = events2[i2++];
            else if (i2 == events2.length) events[i] = events1[i1++];
            else {
                if (events1[i1].blockNumber < events2[i2].blockNumber) events[i] = events1[i1++];
                else events[i] = events2[i2++];
            }
        }

        return events;
    }
}
