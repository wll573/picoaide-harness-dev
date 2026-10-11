export declare const ACCOUNT_DATA_SCOPE_SERVICE = "desktopAccountData";
export interface AccountDataIdentityInput {
    serverURL: string;
    username: string;
}
export interface AccountDataScope {
    readonly root: string;
    matches(account: AccountDataIdentityInput): boolean;
    /** Select the account for the next process; this process keeps its original scope. */
    activate(account: AccountDataIdentityInput): Promise<void>;
}
export declare function accountDataIdentity(account: AccountDataIdentityInput): string;
export declare function accountDataRoot(home: string, account: AccountDataIdentityInput): string;
/** Never adopt the old shared sessions/storages automatically: their owner is unknown. */
export declare function createAccountDataScope(home: string, restart: () => Promise<void>): AccountDataScope;
