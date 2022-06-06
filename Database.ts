import dotenv from 'dotenv';
dotenv.config();  // must be before 'import config...'
import config from 'config';
import * as mysql from 'mysql2/promise';

import * as log from './Log';

let maxConnections = config.get<number>('database.connectionLimit');

let poolConfig = {
    host: config.get<string>('database.host'),
    user: config.get<string>('database.user'),
    password: config.get<string>('database.password'),
    database: config.get<string>('database.database'),
    connectionLimit: maxConnections,
    multipleStatements: true,
    waitForConnections: true
};

export let db = mysql.createPool(poolConfig);
let conCount = 0;

export import DbConnection = mysql.PoolConnection;

export import Data = mysql.RowDataPacket;

export import ExecuteResult = mysql.ResultSetHeader;

db.on('connection', (event) => monitorConnections('connection'));
db.on('acquire', (event) => { conCount++; monitorConnections('acquire'); });
db.on('release', (event) => { conCount--; monitorConnections('release'); });
db.on('enqueue', () => monitorConnections('enqueue'));

function monitorConnections(event: string) {
    // console.log(`monitorConnections `, conCount);

    if (conCount == maxConnections) log.warning(`Max db connections reached: ${maxConnections}`);
}
