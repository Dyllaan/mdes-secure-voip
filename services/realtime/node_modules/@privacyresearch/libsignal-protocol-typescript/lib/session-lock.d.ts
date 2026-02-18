export declare type JobType<T> = () => Promise<T>;
export declare class SessionLock {
    static errors: any[];
    static _promises: Promise<any>[];
    static queueJobForNumber<T>(id: string, runJob: JobType<T>): Promise<T>;
    static clearQueue(): Promise<void>;
}
