export default CoinSelection;
/**
 * - List of 'Value' object
 */
export type AmountList = Value[];
/**
 * - List of UTxO
 */
export type UTxOList = TransactionUnspentOutput[];
/**
 * - Coin Selection algorithm core object
 */
export type UTxOSelection = {
    /**
     * - Accumulated UTxO set.
     */
    selection: UTxOList;
    /**
     * - Remaining UTxO set.
     */
    remaining: UTxOList;
    /**
     * - Remaining UTxO set.
     */
    subset: UTxOList;
    /**
     * - UTxO amount of each requested token
     */
    amount: Value;
};
/**
 * - ImproveRange
 */
export type ImproveRange = {
    /**
     * - Requested amount * 2
     */
    ideal: Value;
    /**
     * - Requested amount * 3
     */
    maximum: Value;
};
/**
 * - Coin Selection algorithm return
 */
export type SelectionResult = {
    /**
     * - Accumulated UTxO set.
     */
    input: UTxOList;
    /**
     * - Requested outputs.
     */
    output: OutputList;
    /**
     * - Remaining UTxO set.
     */
    remaining: UTxOList;
    /**
     * - UTxO amount of each requested token
     */
    amount: Value;
    /**
     * - Accumulated change amount.
     */
    change: Value;
};
export type ProtocolParameters = {
    minUTxO: int;
    minFeeA: int;
    minFeeB: int;
    maxTxSize: int;
};
declare namespace CoinSelection {
    function setLoader(lib: any): void;
    function setProtocolParameters(minUTxO: any, minFeeA: any, minFeeB: any, maxTxSize: any): void;
    function randomImprove(inputs: UTxOList, outputs: TransactionOutputs, limit: int): SelectionResult;
}
//# sourceMappingURL=coinSelection.d.ts.map