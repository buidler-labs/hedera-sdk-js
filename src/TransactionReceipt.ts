import { TransactionReceipt as ProtoTransactionReceipt } from "./generated/TransactionReceipt_pb";
import { AccountId } from "./account/AccountId";
import { ContractId } from "./contract/ContractId";
import { FileId } from "./file/FileId";
import { ExchangeRateSet, exchangeRateSetToSdk } from "./ExchangeRate";
import { Status } from "./Status";

export interface TransactionReceipt {
    status: Status;
    accountId: AccountId | null;
    fileId: FileId | null;
    contractId: ContractId | null;
    exchangeRateSet: ExchangeRateSet | null;
}

export function receiptToSdk(receipt: ProtoTransactionReceipt): TransactionReceipt {
    return {
        status: receipt.getStatus() as Status,
        accountId: receipt.hasAccountid() ? AccountId._fromProto(receipt.getAccountid()!) : null,
        fileId: receipt.hasFileid() ? FileId._fromProto(receipt.getFileid()!) : null,

        contractId: receipt.hasContractid() ?
            ContractId._fromProto(receipt.getContractid()!) :
            null,

        exchangeRateSet: receipt.hasExchangerate() ?
            exchangeRateSetToSdk(receipt.getExchangerate()!) :
            null
    };
}
