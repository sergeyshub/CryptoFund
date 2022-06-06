import dotenv from 'dotenv';
dotenv.config();  // must be before 'import config...'
import config from 'config';
import { ethers } from 'ethers';

import { db, Data, DbConnection } from './Database';

const BTC_ASSET_ID = 1;
const ETH_ASSET_ID = 2;

export const erc20Abi = [
    "function symbol() view returns (string)",
    "function name() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint)",
    "function totalSupply() view returns (uint)"
];

export const fundAbi = [
    "function fundToken() view returns (address)",
    "function getAssetWeights() view returns (uint256[])",
    "function getAssetBalances() view returns (address[], uint256[])",

    "event Transacted(address assetAddress, int256 amount, address user)",
    "event AddedFundAsset(address assetAddress)",
    "event RemovedFundAsset(address assetAddress)",
    "event ChangedAssetWeights(uint256[] newWeights, uint256 changeTime)"
];

export type AssetDictionary = {
    [key: number]: {
        asset: Data
    }
};

export type AssetIdDictionary = {
    [key: number]: {
        price: number
    }
};

export type AssetAddressDictionary = {
    [key: string]: {
        id: number, 
        decimals: number, 
        price: number
    }
};

export type Rpcs = {[key: number]: 
    ethers.providers.JsonRpcProvider
};

export var rpcs: Rpcs = {};

export async function getAssetDictionary(dc: DbConnection, fundId: number): Promise<AssetDictionary> {
    var dictionary: AssetDictionary = {};

    const query = 'SELECT a.* FROM Asset a, FundAsset fa WHERE a.Id = fa.AssetId AND fa.FundId = ? ORDER BY a.Id';

    const [assets, ] = await dc.query<Data[]>(query, [fundId]);

    for (var i = 0; i < assets.length; i++) dictionary[assets[i].Id] = {asset: assets[i]};

    return dictionary;
}

export async function getAssetIdDictionary(dc: DbConnection, fundId: number, hours: number): Promise<AssetIdDictionary> {
    var dictionary: AssetIdDictionary = {};

    const query = 'SELECT ap1.* FROM AssetPrice ap1'
        + ' JOIN (SELECT AssetId, MAX(TimeStamp) AS MaxTimeStamp FROM AssetPrice WHERE ? <= TIMESTAMPDIFF(HOUR, TimeStamp, NOW()) GROUP BY AssetId) ap2'
            + ' ON ap1.AssetId = ap2.AssetId AND ap1.Timestamp = ap2.MaxTimeStamp'
        + ' JOIN FundAsset fa ON ap1.AssetId = fa.AssetId'
        + ' WHERE fa.FundId = ?';

    const [assets, ] = await dc.query<Data[]>(query, [hours, fundId]);

    for (var i = 0; i < assets.length; i++) dictionary[assets[i].AssetId] = {price: assets[i].Price};

    return dictionary;
}

export async function getAssetAddressDictionary(dc: DbConnection, networkId: number): Promise<AssetAddressDictionary> {
    var dictionary: AssetAddressDictionary = {};

    const query = 'SELECT * FROM Asset a, AssetAddress aa'  // need the * here
        + ' WHERE a.Id = aa.AssetId AND aa.NetworkId = ? AND a.Status = 1'
        + ' ORDER BY aa.Address';

    const [assets, ] = await dc.query<Data[]>(query, [networkId]);

    for (var i = 0; i < assets.length; i++) dictionary[assets[i].Address] = {
        id: assets[i].Id, 
        decimals: assets[i].Decimals,
        price: assets[i].Price
    };

    return dictionary;
}
    
export async function getCurrentBlock(networkId: number): Promise<number> {
    const block = await rpcs[networkId].getBlockNumber();
    return block;
}
   
export function bigToNormal(bigNumber: ethers.BigNumber, decimals: number): number {
    const num = Number(ethers.utils.formatUnits(bigNumber, decimals));
    return num;
}

export async function initialize() {
    const [networks, ] = await db.query<Data[]>('SELECT * FROM Network ORDER BY Id');

    for (var i = 0; i < networks.length; i++) {
        if (networks[i].SyncBlock == null) throw new Error(`SyncBlock is null for network '${networks[i].Name}'`);

        rpcs[networks[i].Id] = new ethers.providers.JsonRpcProvider(networks[i].RpcUrl);
    }
}

export function getBtcAssetId(): number {
    return BTC_ASSET_ID;
}

export function getEthAssetId(): number {
    return ETH_ASSET_ID;
}
