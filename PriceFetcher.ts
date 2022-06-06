import dotenv from 'dotenv';
dotenv.config();  // must be before 'import config...'
import config from 'config';
import cron from 'cron';
// import * as mysql from 'mysql2/promise';

import * as log from './Log';
import { db, DbConnection, Data } from './Database';
import Quoter from './Quoter';
import CronLib from './CronLib';

export default class PriceFetcher {
    static cronJob: cron.CronJob;

    public static async start() {
        const minutes = config.get<number>('quoteApi.interval');

        this.cronJob = new cron.CronJob(CronLib.makeCronString(minutes), async () => {
            await this.getPrices();
        });

        this.cronJob.start();

        // TEST:
        // await this.getPrices();

        log.info(`PriceFetcher started`);
    }

    public static stop() {
        this.cronJob.stop();
    }

    private static async getPrices(): Promise<void> {
        try {
            const dc = await db.getConnection();

            const [assets, ] = await dc.query<Data[]>('SELECT * FROM Asset WHERE Status = 1 ORDER BY ApiId');

            if (assets.length == 0) return;

            var apiIds = new Array<number>(assets.length);
            for (var i = 0; i < apiIds.length; i++) apiIds[i] = assets[i].ApiId;

            var prices = await Quoter.getQuotes(apiIds);

            if (assets.length != prices.length) throw new Error(`Assets and prices lengths don't match ${assets.length} and ${prices.length}`);

            var query1 = 'INSERT INTO AssetPrice (AssetId, Price, TotalSupply) VALUES ';
            var query2 = ''

            var lastApiId = 0;
            for (var i = 0; i < prices.length; i++) {
                if (prices[i].apiId < lastApiId) throw new Error(`Prices are not sorted by ApiId ${prices[i].apiId}, last ApiId ${lastApiId}`);
                lastApiId = prices[i].apiId;

                query1 += ` (${assets[i].Id}, ${prices[i].price}, ${prices[i].totalSupply}),`;
                query2 += `UPDATE Asset SET Price = ${prices[i].price} WHERE Id = ${assets[i].Id};`;
            }
            query1 = query1.substring(0, query1.length - 1) + ';';

            // console.log(query);

            await dc.query(query1 + query2);

            dc.release();
        } catch (Error) {
            console.error(Error);
        }
    }
}
