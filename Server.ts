import dotenv from 'dotenv';
dotenv.config();  // must be before 'import config...'
import config from 'config';
import express from 'express';
import type { ErrorRequestHandler } from 'express';

import * as log from './Log';
import * as Utils from './Utils';
import { db, Data } from './Database';
import Fund, { FundTokenInfo } from './models/Fund';
import Charter, { ChartPoint } from './Charter';

const ERROR_SERVER = 1000;
const ERROR_INVALID = 1001;
const ERROR_NOT_FOUND = 1002;

const app = express();
app.use(express.json());

export default class Server {
    static start() {
        const port = config.get<number>('server.port');

        log.info(`Server started, listening on port ${port}`);

        app.listen(port);
    }
}

type TotalInvestedResponse = {
    totalInvested: number;
}

app.get('/totalinvested', async function(req, res, next) {
    try {
        logRequest(`/totalinvested`, req);

        const query = 'SELECT SUM(fv1.TokenSupply * fv1.PriceToken) AS TotalInvested FROM FundValue fv1'
            + ' JOIN (SELECT FundId, MAX(Timestamp) AS MaxTimestamp FROM FundValue GROUP BY FundId) AS fv2 ON fv1.FundId = fv2.FundId AND fv1.Timestamp = fv2.MaxTimestamp'
            + ' JOIN Fund f ON fv1.FundId = f.Id'
            + ' WHERE f.Status = 1';
        const [rows, ] = await db.query<Data[]>(query);

        const response: TotalInvestedResponse = {
            totalInvested: Utils.round(rows[0].TotalInvested, 2)
        }

        // console.log(response);
      
        res.send(response);
    }
    catch (error) {
        next(error);
    }
});

type AssetQuoteResponse = {
    ticker: string;
    price: number;
    totalSupply: number;
}

app.get('/asset/quote/:ticker', async function(req, res, next) {
    try {
        logRequest(`/asset/quote/${req.params.ticker}`, req);

        const query = 'SELECT * FROM AssetPrice ap, Asset a WHERE ap.AssetId = a.Id AND a.Ticker = ? ORDER BY ap.Timestamp DESC LIMIT 1';
        const [rows, ] = await db.query<Data[]>(query, [req.params.ticker]);
        if (rows.length == 0) throw new ErrorI(ERROR_NOT_FOUND, `Asset not found: '${req.params.ticker}'`);

        const response: AssetQuoteResponse = {
            ticker: rows[0].Ticker,
            price: rows[0].Price,
            totalSupply: rows[0].TotalSupply
        }

        // console.log(response);
      
        res.send(response);
    }
    catch (error) {
        next(error);
    }
});

type FundListResponse = {
    ticker: string;
    name: string;
    descShort: string;
    address: string;
    networkId: number;
    timeAdded: Date;
    status: number;
}

app.get('/fund/list/', async function(req, res, next) {
    try {
        logRequest(`/fund/list/`, req);

        const query = 'SELECT * FROM Fund WHERE Status = 1 ORDER BY Id';
        const [rows, ] = await db.query<Data[]>(query);

        var response = new Array<FundListResponse>(rows.length);

        for (var i = 0; i < rows.length; i++) {
            response[i] = {
                ticker: rows[i].Ticker,
                name: rows[i].Name,
                descShort: rows[i].DescShort,
                address: rows[i].Address,
                networkId: rows[i].NetworkId,
                timeAdded: rows[i].TimeAdded,
                status: rows[i].Status
            }
        }

        // console.log(response);
      
        res.send(response);
    }
    catch (error) {
        next(error);
    }
});

type FundResponse = {
    ticker: string;
    name: string;
    descShort: string;
    descLong: string;
    address: string;
    networkId: number;
    timeAdded: Date;
    status: number;
    tokenInfo: FundTokenInfo;
    assets: FundAsset[];
}

type FundAsset = {
    ticker: string;
    name: string;
    weight: number;
    balance: number;
}

app.get('/fund/:ticker', async function(req, res, next) {
    try {
        logRequest(`/fund/${req.params.ticker}`, req);

        const dc = await db.getConnection();

        const query = 'SELECT * FROM Fund WHERE Ticker = ? ORDER BY Id LIMIT 1';
        const [rows, ] = await db.query<Data[]>(query, [req.params.ticker]);
        if (rows.length == 0) throw new ErrorI(ERROR_NOT_FOUND, `Fund not found: '${req.params.ticker}'`);

        const fund = new Fund(dc, rows[0]);
        const rowsAssets = await fund.getAssets();

        const tokenInfo = await fund.getTokenInfo();
        tokenInfo.change = Utils.round(tokenInfo.change, 4);

        var fundAssets = new Array<FundAsset>(rowsAssets.length);

        for (var i = 0; i < rowsAssets.length; i++) {
            fundAssets[i] = {
                ticker: rowsAssets[i].Ticker,
                name: rowsAssets[i].Name,
                weight: rowsAssets[i].Weight,
                balance: rowsAssets[i].Balance
            }
        }

        const response: FundResponse = {
            ticker: rows[0].Ticker,
            name: rows[0].Name,
            descShort: rows[0].DescShort,
            descLong: rows[0].DescLong,
            address: rows[0].Address,
            networkId: rows[0].NetworkId,
            timeAdded: rows[0].TimeAdded,
            status: rows[0].Status,
            tokenInfo: tokenInfo,
            assets: fundAssets
        }

        // console.log(response);

        dc.release();
      
        res.send(response);
    }
    catch (error) {
        next(error);
    }
});

type FundChartResponse = ChartPoint[];

app.post('/fund/chart', async function(req, res, next) {
    try {
        logRequest(`/fund/chart`, req);

        const dc = await db.getConnection();

        if (!req.body.fundTicker) throw new ErrorI(ERROR_INVALID, `fundTicker cannot be empty`);
        if (!req.body.chartType) throw new ErrorI(ERROR_INVALID, `chartType cannot be empty`);

        const [rows, ] = await dc.query<Data[]>('SELECT * FROM Fund WHERE Ticker = ? AND Status = 1', [req.body.fundTicker]);
        if (rows.length == 0) throw new ErrorI(ERROR_NOT_FOUND, `Fund not found: '${req.body.fundTicker}'`);
        const fund = new Fund(dc, rows[0]);

        const response: FundChartResponse = await Charter.getFundChart(dc, fund, req.body.chartType);

        // console.log(response);
      
        dc.release();

        res.send(response);
    }
    catch (error) {
        next(error);
    }
});

type FundUserResponse = {
    balance: number;
    totalValue: number;
    totalInvested: number;
}

app.post('/fund/user', async function(req, res, next) {
    try {
        logRequest(`/fund/user`, req);

        const dc = await db.getConnection();

        if (!req.body.fundTicker) throw new ErrorI(ERROR_INVALID, `fundTicker cannot be empty`);
        if (!req.body.userAddress) throw new ErrorI(ERROR_INVALID, `userAddress cannot be empty`);

        var query = 'SELECT * FROM Fund WHERE Ticker = ? ORDER BY Id';
        var [rows, ] = await dc.query<Data[]>(query, [req.body.fundTicker]);
        if (rows.length == 0) throw new ErrorI(ERROR_NOT_FOUND, `Fund not found: '${req.body.fundTicker}'`);
        const fund = new Fund(dc, rows[0]);

        query = 'SELECT SUM(AmountUsd) AS TotalUsd FROM Fund f, User u, Transaction t WHERE f.Id = t.FundId AND u.Id = t.UserId AND f.Id = ? AND u.Address = ?';
        [rows, ] = await dc.query<Data[]>(query, [fund.id, req.body.userAddress]);
        if (rows.length == 0 || rows[0].TotalUsd == null) throw new ErrorI(ERROR_NOT_FOUND, `User '${req.body.userAddress}' did not use fund '${req.body.fundTicker}'`);
        const totalInvested = rows[0].TotalUsd;
        
        const tokenInfo = await fund.getTokenInfo();

        const userBalance = await fund.getUserBalance(req.body.userAddress);

        const response: FundUserResponse = {
            balance: userBalance,
            totalValue: Utils.round(userBalance * tokenInfo.price, 2),
            totalInvested: Utils.round(totalInvested, 2)
        }

        // console.log(response);

        dc.release();
      
        res.send(response);
    }
    catch (error) {
        next(error);
    }
});

type FundUserChartResponse = ChartPoint[];

app.post('/fund/user/chart', async function(req, res, next) {
    try {
        logRequest(`/fund/user/chart/`, req);

        const dc = await db.getConnection();

        if (!req.body.fundTicker) throw new ErrorI(ERROR_INVALID, `fundTicker cannot be empty`);
        if (!req.body.userAddress) throw new ErrorI(ERROR_INVALID, `userAddress cannot be empty`);
        if (!req.body.chartType) throw new ErrorI(ERROR_INVALID, `chartType cannot be empty`);

        var [rows, ] = await dc.query<Data[]>('SELECT * FROM Fund WHERE Ticker = ? AND Status = 1', [req.body.fundTicker]);
        if (rows.length == 0) throw new ErrorI(ERROR_NOT_FOUND, `Fund not found: '${req.body.fundTicker}'`);
        const fund = new Fund(dc, rows[0]);

        [rows, ] = await dc.query<Data[]>('SELECT * FROM User WHERE Address = ?', [req.body.userAddress]);
        if (rows.length == 0) throw new ErrorI(ERROR_NOT_FOUND, `User not found: '${req.body.userAddress}'`);
        const user = rows[0];

        const response: FundUserChartResponse = await Charter.getFundUserChart(dc, fund, user, req.body.chartType);

        // console.log(response);

        dc.release();
      
        res.send(response);
    }
    catch (error) {
        next(error);
    }
});

function logRequest(path: string, req: express.Request) {
    var ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    log.info(`/api${path} ${ip}`);
}

class ErrorI extends Error {
    code: number;

    constructor(errorCode: number, message: string) {
        super(message);
        this.code = errorCode;
    }
}

type ErrorResponse = {
    code: number;
    message: string;
}

const errorHandler: ErrorRequestHandler = function (err, req, res, next) {
    // log.error(err.message);
    log.error(err);

    if (err.code == undefined) err.code = ERROR_SERVER;

    const response: ErrorResponse = {
        code: err.code,
        message: err.message
    }

    res.status(500).send(response)
};

app.use(errorHandler);
