import log from "./utils/logger.js"
import bedduSalama from "./utils/banner.js"
import { delay, readAccountsFromFile, readFile } from './utils/helper.js';
import { claimMining, getNewToken, getUserFarm, activateMining } from './utils/api.js';

async function refreshAccessToken(token, refreshToken, proxy) {
    let refresh;
    do {
        refresh = await getNewToken(token, refreshToken, proxy);
        if (!refresh) log.info('Token刷新失败，重试中...');
        await delay(3);
    } while (!refresh);

    return refresh;
}

async function activateMiningProcess(token, refreshToken, proxy) {
    let activate;

    do {
        activate = await activateMining(token, proxy);
        if (activate === "unauth") {
            log.warn('未授权，正在刷新token...');
            const refreshedTokens = await refreshAccessToken(token, refreshToken, proxy);
            token = refreshedTokens.accessToken;
            refreshToken = refreshedTokens.refreshToken;
        } else if (!activate) {
            log.info('激活失败，重试中...');
            await delay(3);
        }
    } while (!activate || activate === "unauth");

    log.info('挖矿激活响应:', activate);

    return token;
}

async function getUserFarmInfo(accessToken, refreshToken, proxy, index) {
    let userFarmInfo;
    do {
        userFarmInfo = await getUserFarm(accessToken);
        if (userFarmInfo === "unauth") {
            log.warn(`账户 ${index} 未授权，正在刷新token...`);
            const refreshedTokens = await refreshAccessToken(accessToken, refreshToken, proxy);
            accessToken = refreshedTokens.accessToken;
            refreshToken = refreshedTokens.refreshToken;
        } else if (!userFarmInfo) log.warn(`账户 ${index} 获取农场信息失败，重试中...`);
        await delay(3);
    } while (!userFarmInfo);
    const { status, totalMined } = userFarmInfo;
    log.info(`账户 ${index} 农场信息:`, { status, totalMined });
    return { userFarmInfo, accessToken, refreshToken };
}

async function handleFarming(userFarmInfo, token, refreshToken, proxy) {
    const canBeClaimedAt = new Date(userFarmInfo.canBeClaimedAt).getTime();
    const timeNow = new Date().getTime();

    if (canBeClaimedAt < timeNow) {
        log.info('挖矿奖励可领取，正在尝试领取...');
        let claimResponse;

        do {
            claimResponse = await claimMining(token, proxy);
            if (!claimResponse) log.info('领取挖矿奖励失败，重试中...');
            await delay(3);
        } while (!claimResponse);

        log.info('挖矿奖励领取响应:', claimResponse);
        await activateMiningProcess(token, refreshToken, proxy)
    } else {
        log.info('挖矿奖励可领取时间:', new Date(canBeClaimedAt).toLocaleString())
    }
}

async function main() {
    log.info(bedduSalama)
    const accounts = await readAccountsFromFile("tokens.txt");
    const proxies = await readFile("proxy.txt")
    if (accounts.length === 0) {
        log.warn('未找到token，退出...')
        process.exit(0)
    } else {
        log.info('运行账户总数:', accounts.length);
    }
    if (proxies.length === 0) {
        log.warn('未找到代理，将不使用代理运行...')
    }
    for (let i = 0; i < accounts.length; i++) {
        const proxy = proxies[i % proxies.length] || null;
        const account = accounts[i];
        try {
            const { token, reToken } = account;
            log.info(`正在处理账户 ${i + 1}/${accounts.length}，使用: ${proxy || "无代理"}`);
            await activateMiningProcess(token, reToken, proxy);
            setInterval(async () => {
                const { userFarmInfo, accessToken, refreshToken } = await getUserFarmInfo(token, reToken, proxy, i + 1);
                await handleFarming(userFarmInfo, accessToken, refreshToken, proxy);
            }, 1000 * 60); // 每分钟运行一次
        } catch (error) {
            log.error('错误:', error.message);
        }
        await delay(3);
    }
}

process.on('SIGINT', () => {
    log.warn(`进程收到SIGINT信号，正在清理并退出程序...`);
    process.exit(0);
});

process.on('SIGTERM', () => {
    log.warn(`进程收到SIGTERM信号，正在清理并退出程序...`);
    process.exit(0);
});

main();
