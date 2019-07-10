import { HttpClient } from 'aurelia-fetch-client';
import { usdFormat, queryParam } from 'common/functions';
import { environment } from './../environment';
import { ssc } from './ssc';
import { tryParse } from './functions';
import { dispatchify } from 'aurelia-store';
import { setTokens, getToken, setUserBalances } from 'store/actions';

const http = new HttpClient();

export async function request(url: string, params: any = {}) {
    // Cache buster
    params.v = new Date().getTime();

    url = url + queryParam(params);

    return http.fetch(url, {
        method: 'GET'
    });
}

export async function loadTokens() {
    return new Promise((resolve) => {
        ssc.find('tokens', 'tokens', { }, 1000, 0, [], (err, result) => {
            const tokens = result.filter(t => !environment.DISABLED_TOKENS.includes(t.symbol));

            ssc.find('market', 'metrics', { }, 1000, 0, '', false).then(async (metrics) => {
                for (const token of tokens) {
                    token.highestBid = 0;
                    token.lastPrice = 0;
                    token.lowestAsk = 0;
                    token.marketCap = 0;
                    token.volume = 0;
                    token.priceChangePercent = 0;
                    token.priceChangeSteem = 0;

                    token.metadata = tryParse(token.metadata);

                    if (!token.metadata) {
                        token.metadata = {};
                    }

                    if (!metrics) {
                        return;
                    }

                    const metric = metrics.find(m => token.symbol == m.symbol);

                    if (metric) {
                        token.highestBid = parseFloat(metric.highestBid);
                        token.lastPrice = parseFloat(metric.lastPrice);
                        token.lowestAsk = parseFloat(metric.lowestAsk);
                        token.marketCap = token.lastPrice * token.circulatingSupply;
                        
                        if (Date.now() / 1000 < metric.volumeExpiration) {
                            token.volume = parseFloat(metric.volume);
                        }

                        if(Date.now() / 1000 < metric.lastDayPriceExpiration) {
                            token.priceChangePercent = parseFloat(metric.priceChangePercent);
                            token.priceChangeSteem = parseFloat(metric.priceChangeSteem);
                        }

                        if (token.symbol == 'AFIT') {
                            const afit_data = await ssc.find('market', 'tradesHistory', { symbol: 'AFIT' }, 100, 0, [{ index: 'timestamp', descending: false }], false);
                            token.volume = afit_data.reduce((t, v) => t += parseFloat(v.price) * parseFloat(v.quantity), 0);
                        }
                    }

                    if (token.symbol === 'STEEMP') {
                        token.lastPrice = 1;
                    }
                };

                tokens.sort((a, b) => {
                    return (b.volume > 0 ? b.volume : b.marketCap / 1000000000) - (a.volume > 0 ? a.volume : a.marketCap / 1000000000);
                });

                const steemp_balance = await ssc.findOne('tokens', 'balances', { account: 'steem-peg', symbol: 'STEEMP' });

                if (steemp_balance && steemp_balance.balance) {
                    const token = tokens.find(t => t.symbol === 'STEEMP');

                    token.supply -= parseFloat(steemp_balance.balance);
                    token.circulatingSupply -= parseFloat(steemp_balance.balance);
                }

                if (steemp_balance && steemp_balance.balance) {
                    const token = tokens.find(t => t.symbol === 'STEEMP');

                    token.supply -= parseFloat(steemp_balance.balance);
                    token.circulatingSupply -= parseFloat(steemp_balance.balance);
                }

                // Store the sorted and filtered tokens into the state
                dispatchify(setTokens)(tokens);

                resolve(tokens);
            });
        });
    });
}

export async function getScotUsertokens(account: string) {
    try {
        const req = await this.request(`${environment.SCOT_API}@${account}`);
        const scotTokens = await req.json();
    
        return Object.entries(scotTokens);
    } catch (e) {
        return [];
    }
}

export async function loadPendingUnstakes(account: string) {
    try {
        const result = await ssc.find('tokens', 'pendingUnstakes', { account: account }, 1000, 0, '', false);
    
        return result;
    } catch (e) {
        return [];
    }
}

export async function loadBalances(account?: string): Promise<BalanceInterface[]> {
    const loadedBalances: BalanceInterface[] = await ssc.find('tokens', 'balances', { account: account }, 1000, 0, '', false);

    if (loadedBalances.length) {
        const balances = loadedBalances
            .filter(b => !environment.DISABLED_TOKENS.includes(b.symbol))
            .map(d => {
                const token = this.tokens.find(t => t.symbol === d.symbol);
                const scotConfig = (this.user && Object.keys(this.user.scotTokens).length && typeof this.user.scotTokens[token.symbol] !== 'undefined') 
                ? this.user.scotTokens[token.symbol] : null;

                return { ...d, ...{
                    name: token.name,
                    lastPrice: token.lastPrice,
                    priceChangePercent: token.priceChangePercent,
                    usdValue: usdFormat(parseFloat(d.balance) * token.lastPrice, 2),
                    scotConfig
                } };
            });

        balances.sort((a, b) => parseFloat(b.balance) * b.lastPrice * window.steem_price - parseFloat(b.balance) * a.lastPrice * window.steem_price);

        // Store user balances in state if user is logged in
        dispatchify(setUserBalances)(balances);

        return balances;
    }
}

export function checkTransaction(trx_id, retries, callback) {
    ssc.getTransactionInfo(trx_id, (err, result) => {
        if (result) {
            let error = null;

            if (result.logs) {
                const logs = JSON.parse(result.logs);

                if (logs.errors && logs.errors.length > 0) {
                    error = logs.errors[0];
                }
            }

            if (callback) {
                callback(Object.assign(result, { error: error, success: !error }));
            }	
        } else if (retries > 0) {
            setTimeout(() => this.checkTransaction(trx_id, retries - 1, callback), 5000);
        } else if (callback) {
            callback({ success: false, error: 'Transaction not found.' });
        }
    });
}

export async function claimToken(username: string, symbol: string, tokens: any[], scotTokens: any) {
    const token = tokens.find(t => t.symbol === symbol);
    const amount = scotTokens[symbol].pending_token;
    const factor = Math.pow(10, token.precision);
    const calculated = amount / factor;
    
    const claimData = {
        symbol
    };
    
    if (this.keychain.useKeychain) {
        const response = await this.keychain.customJson(username, 'scot_claim_token', 'Posting', JSON.stringify(claimData),`Claim ${calculated} ${symbol.toUpperCase()} Tokens`);
        
        if (response.success && response.result) {
            // Success
        }
    } else {
        this.steemConnectJsonId(username, 'posting', 'scot_claim_token', claimData, () => {
            // Hide loading
        });
    }
}
