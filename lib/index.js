"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletType = exports.WalletApi = void 0;
const types_1 = require("../src/types");
Object.defineProperty(exports, "WalletType", { enumerable: true, get: function () { return types_1.WalletType; } });
const ERROR = {
    FAILED_PROTOCOL_PARAMETER: 'NO PROTOCOL PARAMS PASSED',
    TX_TOO_BIG: 'Transaction too big',
};
const typeOfwallet = async (type, api) => {
    const wallet = {
        [types_1.WalletType.NAMI]: async () => await api.nami.enable(),
        [types_1.WalletType.CCVAULT]: async () => await api.ccvault.enable(),
        [types_1.WalletType.FLINT]: async () => await api.flint.enable(),
    };
    return wallet[type]();
};
const isTypeOfwalletEnabled = async (type, api) => {
    const wallet = {
        [types_1.WalletType.NAMI]: async () => await api.nami?.isEnabled(),
        [types_1.WalletType.CCVAULT]: async () => await api.ccvault?.isEnabled(),
        [types_1.WalletType.FLINT]: async () => await api.flint?.isEnabled(),
    };
    return wallet[type]();
};
async function WalletApi(walletObject, protocolParameterObject, type, serializationLib) {
    const serialize = serializationLib ||
        (await Promise.resolve().then(() => __importStar(require('@emurgo/cardano-serialization-lib-asmjs'))));
    const Buffer = (await Promise.resolve().then(() => __importStar(require('buffer')))).Buffer;
    const protocolParameter = protocolParameterObject;
    let api = walletObject;
    const CoinSelection = (await Promise.resolve().then(() => __importStar(require('./coinSelection')))).default;
    const enable = async () => {
        try {
            api = await typeOfwallet(type, walletObject);
        }
        catch (error) {
            throw error;
        }
    };
    const isEnabled = async () => await isTypeOfwalletEnabled(type, walletObject);
    const getApiVersion = () => walletObject[type]?.apiVersion;
    const getApiName = () => walletObject[type]?.name;
    const getAddress = async () => {
        return serialize.Address.from_bytes(Buffer.from(await getAddressHex(), 'hex')).to_bech32();
    };
    const getAddressHex = async () => {
        return await api.getChangeAddress();
    };
    const getNetworkId = async () => {
        const id = await api.getNetworkId();
        const network = id == 1 ? 'mainnet' : 'testnet';
        return {
            id,
            network,
        };
    };
    const getUtxos = async () => {
        const Utxos = (await getUtxosHex()).map((u) => serialize.TransactionUnspentOutput.from_bytes(Buffer.from(u, 'hex')));
        let UTXOS = [];
        for (let utxo of Utxos) {
            let assets = _utxoToAssets(utxo);
            UTXOS.push({
                txHash: Buffer.from(utxo.input().transaction_id().to_bytes(), 'hex').toString('hex'),
                txId: utxo.input().index(),
                amount: assets,
            });
        }
        return UTXOS;
    };
    const getAssets = async () => {
        const utxos = await getUtxos();
        let assetsRaw = [];
        utxos.forEach((u) => {
            assetsRaw.push(...u.amount.filter((a) => a.unit != 'lovelace'));
        });
        let assetsMap = {};
        for (const rawAsset of assetsRaw) {
            let quantity = parseInt(rawAsset.quantity);
            if (!assetsMap[rawAsset.unit])
                assetsMap[rawAsset.unit] = 0;
            assetsMap[rawAsset.unit] += quantity;
        }
        return Object.keys(assetsMap).map((asset) => ({
            unit: asset,
            quantity: assetsMap[asset].toString(),
        }));
    };
    const getUtxosHex = async () => await api.getUtxos();
    const send = async ({ address, amount = 0, assets = [], metadata = null, metadataLabel = '721', }) => {
        const lovelace = Math.floor(amount * 1000000).toString();
        const multiAsset = makeMultiAsset(assets);
        const outputValue = serialize.Value.new(serialize.BigNum.from_str(lovelace));
        const paymentAddress = await getAddress();
        const receiveAddress = address;
        const outputs = serialize.TransactionOutputs.new();
        const utxos = (await getUtxosHex()).map((u) => serialize.TransactionUnspentOutput.from_bytes(Buffer.from(u, 'hex')));
        if (assets.length > 0) {
            outputValue.set_multiasset(multiAsset);
        }
        const minAda = serialize.min_ada_required(outputValue, serialize.BigNum.from_str(protocolParameter.minUtxo || '1000000'));
        if (serialize.BigNum.from_str(lovelace).compare(minAda) < 0) {
            outputValue.set_coin(minAda);
        }
        outputs.add(serialize.TransactionOutput.new(serialize.Address.from_bech32(receiveAddress), outputValue));
        const RawTransaction = _txBuilder({
            PaymentAddress: paymentAddress,
            Utxos: utxos,
            Outputs: outputs,
            ProtocolParameter: protocolParameter,
            Metadata: metadata,
            MetadataLabel: metadataLabel,
            Delegation: null,
        });
        return await _signSubmitTx(RawTransaction);
    };
    async function sendMultiple({ recipients = [], metadata = null, metadataLabel = '721', }) {
        let PaymentAddress = await getAddress();
        let utxos = (await getUtxosHex()).map((u) => serialize.TransactionUnspentOutput.from_bytes(Buffer.from(u, 'hex')));
        let outputs = serialize.TransactionOutputs.new();
        for (let recipient of recipients) {
            let lovelace = Math.floor((recipient.amount || 0) * 1000000).toString();
            let ReceiveAddress = recipient.address;
            let multiAsset = makeMultiAsset(recipient.assets || []);
            let outputValue = serialize.Value.new(serialize.BigNum.from_str(lovelace));
            if ((recipient.assets || []).length > 0)
                outputValue.set_multiasset(multiAsset);
            let minAda = serialize.min_ada_required(outputValue, serialize.BigNum.from_str(protocolParameter.minUtxo || '1000000'));
            if (serialize.BigNum.from_str(lovelace).compare(minAda) < 0)
                outputValue.set_coin(minAda);
            outputs.add(serialize.TransactionOutput.new(serialize.Address.from_bech32(ReceiveAddress), outputValue));
        }
        let RawTransaction = _txBuilder({
            PaymentAddress: PaymentAddress,
            Utxos: utxos,
            Outputs: outputs,
            ProtocolParameter: protocolParameter,
            Metadata: metadata,
            MetadataLabel: metadataLabel,
            Delegation: null,
        });
        return await _signSubmitTx(RawTransaction);
    }
    async function signData(string) {
        let address = await getAddressHex();
        let coseSign1Hex = await api.signData(address, Buffer.from(string, 'ascii').toString('hex'));
        return coseSign1Hex;
    }
    //////////////////////////////////////////////////
    //Auxiliary
    function AsciiToBuffer(string) {
        return Buffer.from(string, 'ascii');
    }
    function HexToBuffer(string) {
        return Buffer.from(string, 'hex');
    }
    function AsciiToHex(string) {
        return AsciiToBuffer(string).toString('hex');
    }
    function HexToAscii(string) {
        return HexToBuffer(string).toString('ascii');
    }
    function BufferToAscii(buffer) {
        return buffer.toString('ascii');
    }
    function BufferToHex(buffer) {
        return buffer.toString('hex');
    }
    //////////////////////////////////////////////////
    function makeMultiAsset(assets) {
        let AssetsMap = {};
        for (let asset of assets) {
            let [policy, assetName] = asset.unit.split('.');
            let quantity = asset.quantity;
            if (!Array.isArray(AssetsMap[policy])) {
                AssetsMap[policy] = [];
            }
            AssetsMap[policy].push({
                unit: Buffer.from(assetName, 'ascii').toString('hex'),
                quantity: quantity,
            });
        }
        let multiAsset = serialize.MultiAsset.new();
        for (const policy in AssetsMap) {
            const ScriptHash = serialize.ScriptHash.from_bytes(Buffer.from(policy, 'hex'));
            const Assets = serialize.Assets.new();
            const _assets = AssetsMap[policy];
            for (const asset of _assets) {
                const AssetName = serialize.AssetName.new(Buffer.from(asset.unit, 'hex'));
                const BigNum = serialize.BigNum.from_str(asset.quantity);
                Assets.insert(AssetName, BigNum);
            }
            multiAsset.insert(ScriptHash, Assets);
        }
        return multiAsset;
    }
    function _utxoToAssets(utxo) {
        let value = utxo.output().amount();
        const assets = [];
        assets.push({ unit: 'lovelace', quantity: value.coin().to_str() });
        if (value.multiasset()) {
            const multiAssets = value.multiasset().keys();
            for (let j = 0; j < multiAssets.len(); j++) {
                const policy = multiAssets.get(j);
                const policyAssets = value.multiasset().get(policy);
                const assetNames = policyAssets.keys();
                for (let k = 0; k < assetNames.len(); k++) {
                    const policyAsset = assetNames.get(k);
                    const quantity = policyAssets.get(policyAsset);
                    const asset = Buffer.from(policy.to_bytes()).toString('hex') +
                        '.' +
                        Buffer.from(policyAsset.name()).toString('ascii');
                    assets.push({
                        unit: asset,
                        quantity: quantity.to_str(),
                    });
                }
            }
        }
        return assets;
    }
    function _txBuilder({ PaymentAddress, Utxos, Outputs, ProtocolParameter, Metadata = null, MetadataLabel = '721', Delegation = null, }) {
        const MULTIASSET_SIZE = 5000;
        const VALUE_SIZE = 5000;
        const totalAssets = 0;
        CoinSelection.setLoader(serialize);
        CoinSelection.setProtocolParameters(ProtocolParameter.minUtxo.toString(), ProtocolParameter.linearFee.minFeeA.toString(), ProtocolParameter.linearFee.minFeeB.toString(), ProtocolParameter.maxTxSize.toString());
        const selection = CoinSelection.randomImprove(Utxos, Outputs, 20 + totalAssets
        //ProtocolParameter.minUtxo.to_str()
        );
        const inputs = selection.input;
        const txBuilder = serialize.TransactionBuilder.new(serialize.LinearFee.new(serialize.BigNum.from_str(ProtocolParameter.linearFee.minFeeA), serialize.BigNum.from_str(ProtocolParameter.linearFee.minFeeB)), serialize.BigNum.from_str(ProtocolParameter.minUtxo.toString()), serialize.BigNum.from_str(ProtocolParameter.poolDeposit.toString()), serialize.BigNum.from_str(ProtocolParameter.keyDeposit.toString()), MULTIASSET_SIZE, MULTIASSET_SIZE);
        for (let i = 0; i < inputs.length; i++) {
            const utxo = inputs[i];
            txBuilder.add_input(utxo.output().address(), utxo.input(), utxo.output().amount());
        }
        if (Delegation) {
            let certificates = serialize.Certificates.new();
            if (!Delegation.delegation.active) {
                certificates.add(serialize.Certificate.new_stake_registration(serialize.StakeRegistration.new(serialize.StakeCredential.from_keyhash(serialize.Ed25519KeyHash.from_bytes(Buffer.from(Delegation.stakeKeyHash, 'hex'))))));
            }
            let poolKeyHash = Delegation.poolHex;
            certificates.add(serialize.Certificate.new_stake_delegation(serialize.StakeDelegation.new(serialize.StakeCredential.from_keyhash(serialize.Ed25519KeyHash.from_bytes(Buffer.from(Delegation.stakeKeyHash, 'hex'))), serialize.Ed25519KeyHash.from_bytes(Buffer.from(poolKeyHash, 'hex')))));
            txBuilder.set_certs(certificates);
        }
        let AUXILIARY_DATA;
        if (Metadata) {
            let METADATA = serialize.GeneralTransactionMetadata.new();
            METADATA.insert(serialize.BigNum.from_str(MetadataLabel), serialize.encode_json_str_to_metadatum(JSON.stringify(Metadata), 0));
            AUXILIARY_DATA = serialize.AuxiliaryData.new();
            AUXILIARY_DATA.set_metadata(METADATA);
            //const auxiliaryDataHash = serialize.hash_auxiliary_data(AUXILIARY_DATA)
            txBuilder.set_auxiliary_data(AUXILIARY_DATA);
        }
        for (let i = 0; i < Outputs.len(); i++) {
            txBuilder.add_output(Outputs.get(i));
        }
        const change = selection.change;
        const changeMultiAssets = change.multiasset();
        // check if change value is too big for single output
        if (changeMultiAssets && change.to_bytes().length * 2 > VALUE_SIZE) {
            const partialChange = serialize.Value.new(serialize.BigNum.from_str('0'));
            const partialMultiAssets = serialize.MultiAsset.new();
            const policies = changeMultiAssets.keys();
            const makeSplit = () => {
                for (let j = 0; j < changeMultiAssets.len(); j++) {
                    const policy = policies.get(j);
                    const policyAssets = changeMultiAssets.get(policy);
                    const assetNames = policyAssets.keys();
                    const assets = serialize.Assets.new();
                    for (let k = 0; k < assetNames.len(); k++) {
                        const policyAsset = assetNames.get(k);
                        const quantity = policyAssets.get(policyAsset);
                        assets.insert(policyAsset, quantity);
                        //check size
                        const checkMultiAssets = serialize.MultiAsset.from_bytes(partialMultiAssets.to_bytes());
                        checkMultiAssets.insert(policy, assets);
                        const checkValue = serialize.Value.new(serialize.BigNum.from_str('0'));
                        checkValue.set_multiasset(checkMultiAssets);
                        if (checkValue.to_bytes().length * 2 >= VALUE_SIZE) {
                            partialMultiAssets.insert(policy, assets);
                            return;
                        }
                    }
                    partialMultiAssets.insert(policy, assets);
                }
            };
            makeSplit();
            partialChange.set_multiasset(partialMultiAssets);
            const minAda = serialize.min_ada_required(partialChange, serialize.BigNum.from_str(ProtocolParameter.minUtxo));
            partialChange.set_coin(minAda);
            txBuilder.add_output(serialize.TransactionOutput.new(serialize.Address.from_bech32(PaymentAddress), partialChange));
        }
        txBuilder.add_change_if_needed(serialize.Address.from_bech32(PaymentAddress));
        const transaction = serialize.Transaction.new(txBuilder.build(), serialize.TransactionWitnessSet.new(), AUXILIARY_DATA);
        const size = transaction.to_bytes().length * 2;
        if (size > ProtocolParameter.maxTxSize)
            throw ERROR.TX_TOO_BIG;
        return transaction.to_bytes();
    }
    async function _signSubmitTx(transactionRaw) {
        let transaction = serialize.Transaction.from_bytes(transactionRaw);
        const witneses = await api.signTx(Buffer.from(transaction.to_bytes()).toString('hex'));
        const signedTx = serialize.Transaction.new(transaction.body(), serialize.TransactionWitnessSet.from_bytes(Buffer.from(witneses, 'hex')), transaction.auxiliary_data());
        const txhash = await api.submitTx(Buffer.from(signedTx.to_bytes()).toString('hex'));
        return txhash;
    }
    return {
        isEnabled,
        enable,
        getAddress,
        getAddressHex,
        getNetworkId,
        getUtxos,
        getAssets,
        getUtxosHex,
        getApiVersion,
        getApiName,
        send,
        sendMultiple,
        auxiliary: {
            Buffer: Buffer,
            AsciiToBuffer: AsciiToBuffer,
            HexToBuffer: HexToBuffer,
            AsciiToHex: AsciiToHex,
            HexToAscii: HexToAscii,
            BufferToAscii: BufferToAscii,
            BufferToHex: BufferToHex,
        },
    };
}
exports.WalletApi = WalletApi;
//# sourceMappingURL=index.js.map