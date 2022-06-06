import dotenv from 'dotenv';
dotenv.config();  // must be before 'import config...'
import config from 'config';

import * as BlockLib from './BlockLib';
import Server from './Server';
import PriceFetcher from './PriceFetcher';
import Snapshoter from './Snapshoter';
import Synchronizer from './Synchronizer';

start();

async function start() {
    await BlockLib.initialize();
    
    PriceFetcher.start();
    Snapshoter.start();
    Synchronizer.start();
    Server.start();
}
