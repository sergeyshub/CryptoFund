import dotenv from 'dotenv';
dotenv.config();  // must be before 'import config...'
import config from 'config';
import { ethers } from 'ethers';
import cron from 'cron';

import * as log from './Log';
import { db, DbConnection, Data } from './Database';
import CronLib from './CronLib';
import * as BlockLib from './BlockLib';
import Fund, { FundTokenInfo } from './models/Fund';

export default class Snapshoter {
    static cronJob: cron.CronJob;

    public static async start() {
        const minutes = config.get<number>('blockchain.intervalBalance');

        this.cronJob = new cron.CronJob(CronLib.makeCronString(minutes), async () => {
            await this.getFundSnaphots();
        });

        this.cronJob.start();

        /// TEST:
        // await this.getFundSnaphots();

        log.info(`Snapshoter started`);
    }

    public static stop() {
        this.cronJob.stop();
    }

    private static async getFundSnaphots(): Promise<void> {
        try {
            const dc = await db.getConnection();

            const [funds, ] = await dc.query<Data[]>('SELECT * FROM Fund WHERE Status = 1 ORDER BY Id');
        
            for (var i = 0; i < funds.length; i++) {
                const fund = new Fund(dc, funds[i]);

                await this.getFundTokenBalances(dc, fund);
                await this.getFundValue(dc, fund);
            }

            dc.release();
        } catch (error) {
            console.error(error);
        }
    }

    private static async getFundTokenBalances(dc: DbConnection, fund: Fund) {
        const assetDictionary = await BlockLib.getAssetAddressDictionary(dc, fund.networkId);

        // Get fund token balances
        const fundContract = new ethers.Contract(fund.address, BlockLib.fundAbi, BlockLib.rpcs[fund.networkId]);
        const [addresses, balances] = await fundContract.getAssetBalances();
        const weights = await fundContract.getAssetWeights();

        if (addresses.length == 0 || addresses.length != balances.length || addresses.length != weights.length)
            throw new Error(`Addresses, balances, or weights length in invalid ${addresses.length}, ${balances.length} and ${weights.length}`);

        var query1 = 'INSERT INTO FundAssetBalance (FundId, AssetId, Weight, Balance, Price) VALUES ';
        var query2 = ''

        for (var i = 0; i < balances.length; i++) {
            const assetId = assetDictionary[addresses[i]]?.id;
            if (assetId == undefined) throw new Error(`Asset address not in the dictionary '${addresses[i]}'`);

            const decimals = assetDictionary[addresses[i]].decimals;
            const balance = BlockLib.bigToNormal(balances[i], decimals);
            const weight = BlockLib.bigToNormal(weights[i], 18);
            const price = assetDictionary[addresses[i]].price;
            // console.log(`Token: ${addresses[i]}, weight: ${weight}, balance: ${balance}`);

            query1 += ` (${fund.id}, ${assetId}, ${weight}, ${balance}, ${price}),`;
            query2 += `UPDATE FundAsset SET Weight = ${weight}, Balance = ${balance} WHERE FundId = ${fund.id} AND AssetId = ${assetId};`;
        }
        query1 = query1.substring(0, query1.length - 1) + ';';

        // console.log(query1 + query2);
    
        await dc.query(query1 + query2); // Need to use dc.query(), not dc.execute() for multiple statements
    }

    private static async getFundValue(dc: DbConnection, fund: Fund) {
        const fundAssets = await fund.getAssets();
        const tokenInfo = await this.computeTokenInfo(dc, fund, fundAssets);

        var [rows, ] = await dc.query<Data[]>('SELECT Price FROM AssetPrice WHERE AssetId = ? ORDER BY Timestamp DESC LIMIT 1', BlockLib.getBtcAssetId());
        if (rows.length == 0) throw new Error(`Asset BTC not found`);
        const priceBtc = rows[0].Price;

        [rows, ] = await dc.query<Data[]>('SELECT Price FROM AssetPrice WHERE AssetId = ? ORDER BY Timestamp DESC LIMIT 1', BlockLib.getEthAssetId());
        if (rows.length == 0) throw new Error(`Asset ETH not found`);
        const priceEth = rows[0].Price;

        var query = 'SELECT SUM(AmountUsd) AS InvestedUsd, SUM(AmountBtc) AS InvestedBtc, SUM(AmountEth) AS InvestedEth FROM Transaction WHERE FundId = ?';
        var [rows, ] = await dc.query<Data[]>(query, [fund.id]);
        const invsetData = rows[0];

        var investedUsd = 0;
        var investedBtc = 0;
        var investedEth = 0;

        if (rows[0].InvestedUsd != null) {
            investedUsd = rows[0].InvestedUsd;
            investedBtc = rows[0].InvestedBtc == null ? 0 : rows[0].InvestedBtc;
            investedEth = rows[0].InvestedEth == null ? 0 : rows[0].InvestedEth;
        }

        query = 'INSERT INTO FundValue (FundId, TokenSupply, PriceToken, PriceBtc, PriceEth, InvestedUsd, InvestedBtc, InvestedEth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        await dc.query(query, [fund.id, tokenInfo.supply, tokenInfo.price, priceBtc, priceEth, investedUsd, investedBtc, investedEth]);
    }

    private static async computeTokenInfo(dc: DbConnection, fund: Fund, fundAssets: Data[]): Promise<FundTokenInfo> {
        // Get number of fund tokens
        if (!fund.tokenAddress) throw new Error(`Token address not set for fund '${fund.ticker}'`);
        const tokenContract = new ethers.Contract(fund.tokenAddress, BlockLib.erc20Abi, BlockLib.rpcs[fund.networkId]);
        const supplyBig = await tokenContract.totalSupply();
        const tokenSupply = BlockLib.bigToNormal(supplyBig, 18);

        var sharePriceNow: number = null;

        var assetDictionary = await BlockLib.getAssetIdDictionary(dc, fund.id, 0);

        return tokenInfo;
    }

    private static computeTokenPrice(fundAssets: Data[], tokenSupply: number, assetDictionary: BlockLib.AssetIdDictionary): number {
        var value = 0;

        for (var i = 0; i < fundAssets.length; i++) value += fundAssets[i].Balance * assetDictionary[fundAssets[i].Id].price;
        var tokenPrice = value / tokenSupply;

        // console.log(`Value = ${value}, token price = ${tokenPrice}`);

        return tokenPrice;
    }
}
