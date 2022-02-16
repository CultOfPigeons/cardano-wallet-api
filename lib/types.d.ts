import { Buffer } from 'buffer';
declare type Endpoints = {
    isEnabled: () => Promise<boolean>;
    enable: () => Promise<void>;
    getAddress: () => Promise<string>;
    getAddressHex: () => Promise<string>;
    getNetworkId: () => Promise<{
        id: number;
        network: string;
    }>;
    getUtxos: () => Promise<Utxo[]>;
    getAssets: () => Promise<Asset[]>;
    getApiVersion: () => String;
    getApiName: () => String;
    getUtxosHex: () => Promise<string[]>;
    send: (data: Send) => Promise<string>;
    sendMultiple: (data: SendMultiple) => Promise<string>;
    auxiliary: Auxiliary;
};
declare type Utxo = {
    txHash: string;
    txId: number;
    amount: Asset[];
};
declare type Asset = {
    unit: string;
    quantity: string;
};
declare type Send = {
    address: string;
    amount?: number;
    assets?: Asset[];
    metadata?: any;
    metadataLabel?: string;
};
declare type SendMultiple = {
    recipients: {
        address: string;
        amount?: number;
        assets?: Asset[];
    }[];
    metadata?: any;
    metadataLabel?: string;
};
declare type ProtocolParameter = {
    linearFee: {
        minFeeA: string;
        minFeeB: string;
    };
    minUtxo: '1000000';
    poolDeposit: string;
    keyDeposit: string;
    maxTxSize: number;
    slot: number;
};
declare type Auxiliary = {
    Buffer: object;
    AsciiToBuffer: (string: string) => Buffer;
    HexToBuffer: (string: string) => Buffer;
    AsciiToHex: (string: string) => string;
    HexToAscii: (string: string) => string;
    BufferToAscii: (buffer: Buffer) => string;
    BufferToHex: (buffer: Buffer) => string;
};
declare enum WalletType {
    NAMI = "nami",
    CCVAULT = "ccvault",
    FLINT = "flint"
}
export { Asset, Auxiliary, Endpoints, ProtocolParameter, Send, SendMultiple, Utxo, WalletType };
//# sourceMappingURL=types.d.ts.map