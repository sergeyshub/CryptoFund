import { ethers } from 'ethers';

import { Data, DbConnection } from '../Database';
import * as BlockLib from '../BlockLib';

export type FundTokenInfo = {
    ticker: string;
    name: string;
    address: string;
    supply: number;
    price: number | null;
    change: number | null;
};

export default class Fund {
    public id: number;
    public ticker: string;
    public name: string;
    public descShort: string;
    public descLong: string;
    public address: string;
    public networkId: number;
    public tokenTicker: string;
    public tokenName: string;
    public tokenAddress: string;
    public timeAdded: Date;
    public status: number;

    private dc: DbConnection;

    constructor(dc: DbConnection, data: Data) {
        this.dc = dc;

        this.id = data.Id;
        this.ticker = data.Ticker;
        this.name = data.Name;
        this.descShort = data.DescShort;
        this.descLong = data.DescLong;
        this.address = data.Address;
        this.networkId = data.NetworkId;
        this.tokenTicker = data.TokenTicker;
        this.tokenName = data.TokenName;
        this.tokenAddress = data.TokenAddress;
        this.timeAdded = data.TimeAdded;
        this.status = data.Status;
    }

    public async getAssets(): Promise<Data[]> {
        const query = 'SELECT a.Id, a.Ticker, a.Name, fa.Weight, fa.Balance FROM Asset a, FundAsset fa WHERE a.Id = fa.AssetId AND FundId = ? ORDER BY AssetId';
        const [rows, ] = await this.dc.query<Data[]>(query, [this.id]);
        return rows;
    }

    public async getTokenInfo(): Promise<FundTokenInfo> {
        var query = 'SELECT * FROM FundValue WHERE FundId = ? ORDER BY Timestamp DESC LIMIT 1';
        var [rows, ] = await this.dc.query<Data[]>(query, [this.id]);
        const tokenPriceNow = rows[0]?.PriceToken;
        const tokenSupplyNow = rows[0]?.TokenSupply;
        const investedNow = rows[0]?.InvestedUsd;

        query = 'SELECT * FROM FundValue WHERE FundId = ? AND 24 <= TIMESTAMPDIFF(HOUR, TimeStamp, NOW()) ORDER BY Timestamp DESC LIMIT 1';
        [rows, ] = await this.dc.query<Data[]>(query, [this.id]);
        const tokenPrice24 = rows[0]?.PriceToken;
        const tokenSupply24 = rows[0]?.TokenSupply;
        const invested24 = rows[0]?.InvestedUsd;

        var priceChange: number = null;

        if (tokenPriceNow != undefined && tokenPrice24 != undefined) {
            const valueNow = tokenPriceNow * tokenSupplyNow;
            const value24 = tokenPrice24 * tokenSupply24;
            priceChange = (valueNow / investedNow - value24 / invested24) / (value24 / invested24);
        }

        var tokenInfo: FundTokenInfo = {
            ticker: this.tokenTicker,
            name: this.tokenName,
            address: this.tokenAddress,
            supply: tokenSupplyNow,
            price: tokenPriceNow,
            change: priceChange
        };

        return tokenInfo;
    }
    
    public async getUserBalance(userAddress: string): Promise<number> {
        const tokenContract = new ethers.Contract(this.tokenAddress, BlockLib.erc20Abi, BlockLib.rpcs[this.networkId]);
        const balanceBig = await tokenContract.balanceOf(userAddress);
        const balance = BlockLib.bigToNormal(balanceBig, 18);

        return balance;
    }
}
