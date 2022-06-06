import { Data, DbConnection } from '../Database';

export default class Asset {
    id: number;
    ticker: string;
    name: string;
    decimals: string;
    status: number;

    constructor(data: Data) {
        this.id = data.Id;
        this.ticker = data.Ticker;
        this.name = data.Name;
        this.decimals = data.Decimals;
        this.status = data.Status;
    }

    public async getPrice(dc: DbConnection, time: Date): Promise<number> {
        var query = 'SELECT Price FROM AssetPrice WHERE AssetId = ? AND Timestamp <= ? ORDER BY Timestamp DESC LIMIT 1';
        var [rows, ] = await dc.query<Data[]>(query, [this.id, time]);

        if (rows.length == 0) {
            query = 'SELECT Price FROM AssetPrice WHERE AssetId = ? AND Timestamp > ? ORDER BY Timestamp LIMIT 1';
            [rows, ] = await dc.query<Data[]>(query, [this.id, time]);

            if (rows.length == 0) throw new Error(`Could not find price for '${this.ticker}'`);
        }

        return rows[0].Price;
    }
}
