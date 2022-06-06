import * as Utils from './Utils';

export function info(message: string) {
    console.log(`[${Utils.getDateString()}] ${message}`);
}

export function error(message: string) {
    console.error(`[${Utils.getDateString()}] ${message}`);
}

export function warning(message: string) {
    console.warn(`[${Utils.getDateString()}] ${message}`);
}
