import dotenv from 'dotenv';
dotenv.config();  // must be before 'import config...'

import * as log from './Log';
import * as Utils from './Utils';
import { DbConnection, Data } from './Database';
import * as BlockLib from './BlockLib';
import Fund from './models/Fund';

export type ChartPoint = {
    priceFund: number;
    priceBtc: number;
    priceEth: number;
    changeFund: number;
    changeBtc: number;
    changeEth: number;
    valueFund: number;
    valueBtc: number;
    valueEth: number;
    investedUsd: number;
    investedBtc: number;
    investedEth: number;
    time: Date;
}

export default class Charter {
    public static async getFundChart(dc: DbConnection, fund: Fund, chartType: string): Promise<ChartPoint[]> {
        const rows = await this.getFundChartRows(dc, fund, chartType);

        // const tokenInfo = await fund.getTokenInfo();

        var chartPoints = this.rowsToChartPoints(1, rows);

        return chartPoints;
    }

    public static async getFundUserChart(dc: DbConnection, fund: Fund, user: Data, chartType: string): Promise<ChartPoint[]> {
        const rows = await this.getFundUserChartRows(dc, fund, user.Id, chartType);

        const userBalance = await fund.getUserBalance(user.Address);
        const tokenInfo = await fund.getTokenInfo();

        const fundShare = userBalance / tokenInfo.supply;

        // console.log(`User ${user.Id}, balance = ${userBalance}, fundShare = ${fundShare}`);

        var chartPoints = this.rowsToChartPoints(fundShare, rows);

        return chartPoints;
    }

    private static async getFundChartRows(dc: DbConnection, fund: Fund, chartType: string): Promise<Data[]> {
        const [timeStart, timeStep, timeOffset] = await this.getStartAndStep(dc, fund, chartType);

        // console.log(`timeStart = ${timeStart}, timeStep = ${timeStep}, timeOffset = ${timeOffset}`);

        const query = 'SELECT * FROM FundValue'
            + ' WHERE ? <= Timestamp'
            + ' GROUP BY TRUNCATE((UNIX_TIMESTAMP(Timestamp) - ?) / ?, 0)'
            + ' ORDER BY Timestamp';
        const [rows, ] = await dc.query<Data[]>(query, [timeStart, timeOffset, timeStep]);

        return rows;
    }

    private static async getFundUserChartRows(dc: DbConnection, fund: Fund, userId: number, chartType: string): Promise<Data[]> {
        const [timeStart, timeStep, timeOffset] = await this.getStartAndStep(dc, fund, chartType);

        const query = 'SELECT *,'
                + ' (SELECT SUM(t.AmountUsd) FROM Transaction t WHERE FundId = ? AND UserId = ? AND t.Timestamp <= fv.Timestamp) AS UserInvestedUsd,'
                + ' (SELECT SUM(t.AmountBtc) FROM Transaction t WHERE FundId = ? AND UserId = ? AND t.Timestamp <= fv.Timestamp) AS UserInvestedBtc,'
                + ' (SELECT SUM(t.AmountEth) FROM Transaction t WHERE FundId = ? AND UserId = ? AND t.Timestamp <= fv.Timestamp) AS UserInvestedEth'
            + ' FROM FundValue fv'
            + ' WHERE ? <= fv.Timestamp'
            + ' GROUP BY TRUNCATE((UNIX_TIMESTAMP(fv.Timestamp) - ?) / ?, 0)'
            + ' ORDER BY fv.Timestamp';
        const [rows, ] = await dc.query<Data[]>(query, [fund.id, userId, fund.id, userId, fund.id, userId, timeStart, timeOffset, timeStep]);

        return rows;
    }

    private static rowsToChartPoints(fundShare: number, rows: Data[]): ChartPoint[] {
        var chartPoints = new Array<ChartPoint>(rows.length);

         for (var i = 0; i < rows.length; i++) {
            const fundShareValue = rows[i].PriceToken * rows[i].TokenSupply * fundShare;
            const investedUsd = fundShare == 1 ? rows[i].InvestedUsd : rows[i].UserInvestedUsd;
            const investedBtc = fundShare == 1 ? rows[i].InvestedBtc : rows[i].UserInvestedBtc;
            const investedEth = fundShare == 1 ? rows[i].InvestedEth : rows[i].UserInvestedEth;

            chartPoints[i] = {
                priceFund: Utils.round(rows[i].PriceToken, 2),
                priceBtc: Utils.round(rows[i].PriceBtc, 2),
                priceEth: Utils.round(rows[i].PriceEth, 2),
                changeFund: Utils.round((fundShareValue - investedUsd) / investedUsd, 4),
                changeBtc: Utils.round((investedBtc * rows[i].PriceBtc - investedUsd) / investedUsd, 4),
                changeEth: Utils.round((investedEth * rows[i].PriceEth - investedUsd) / investedUsd, 4),
                valueFund: Utils.round(fundShareValue, 2),
                valueBtc: Utils.round(investedBtc * rows[i].PriceBtc, 8),
                valueEth: Utils.round(investedEth * rows[i].PriceEth, 8),
                investedUsd: Utils.round(investedUsd, 2),
                investedBtc: Utils.round(investedBtc, 8),
                investedEth: Utils.round(investedEth, 8),
                time: rows[i].Timestamp
            };
        }

        return chartPoints;
    }

    private static async getStartAndStep(dc: DbConnection, fund: Fund, chartType: string): Promise<[Date, number, number]> {
        const [rows, ] = await dc.query<Data[]>('SELECT MAX(Timestamp) AS MaxTimestamp, MAX(UNIX_TIMESTAMP(Timestamp)) AS MaxUnixTimestamp FROM FundValue');
        const maxTimestamp = rows[0].MaxTimestamp == null ? new Date() : rows[0].MaxTimestamp;
        const maxUnixTimestamp = rows[0].MaxUnixTimestamp;

        var timeStart = maxTimestamp;
        var timeStep : number;

        switch(chartType) { 
            case 'week': { 
                timeStart.setDate(timeStart.getDate() - 7);
                timeStep = 60 * 60; // one hour
                break; 
            } 
            case 'month': { 
                timeStart.setDate(timeStart.getDate() - 30);
                timeStep = 60 * 60; // one hour
                break; 
            } 
            case 'year': { 
                timeStart.setDate(timeStart.getDate() - 365);
                timeStep = 24 * 60 * 60; // one day
                break; 
            } 
            case 'all-time': {
                timeStart = fund.timeAdded;
                timeStep = 7 * 24 * 60 * 60; // one week
                break; 
            } 
            default: { 
                throw new Error(`Unknown chart type '${chartType}'`);
            } 
        }
        
        const timeOffset = maxUnixTimestamp == null ? 0 : maxUnixTimestamp % timeStep;

        return [timeStart, timeStep, timeOffset];
    }
}