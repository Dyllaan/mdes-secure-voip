"use strict";
/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 * jobQueue manages multiple queues indexed by device to serialize
 * session io ops on the database.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionLock = void 0;
const jobQueue = {};
class SessionLock {
    static queueJobForNumber(id, runJob) {
        const runPrevious = jobQueue[id] || Promise.resolve();
        const runCurrent = (jobQueue[id] = runPrevious.then(runJob, runJob));
        const promise = runCurrent
            .then(function () {
            if (jobQueue[id] === runCurrent) {
                delete jobQueue[id];
            }
        })
            .catch((e) => {
            // SessionLock callers should already have seen these errors on their own
            // Promise chains, but we need to handle them here too so we just save them
            // so callers can review them.
            SessionLock.errors.push(e);
        });
        SessionLock._promises.push(promise);
        return runCurrent;
    }
    static clearQueue() {
        return __awaiter(this, void 0, void 0, function* () {
            yield Promise.all(SessionLock._promises);
        });
    }
}
exports.SessionLock = SessionLock;
SessionLock.errors = [];
SessionLock._promises = [];
