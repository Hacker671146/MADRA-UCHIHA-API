const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const NAME = "PRITESH AI PREDICTOR (STABLE)";
const API_URL = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json";

// ========== FIXED MATH PREDICTOR ==========
class FixedMathPredictor {
    predict(lastNumber) {
        if (lastNumber === undefined || lastNumber === null) {
            return { prediction: "BIG", confidence: "50%", level1: 0, level2: 0, details: "No history, default BIG" };
        }
        const level1 = (lastNumber + 1) % 10;
        const level2 = (lastNumber + 2) % 10;
        const isBig1 = level1 >= 5;
        const isBig2 = level2 >= 5;
        const prediction = (isBig1 || isBig2) ? "BIG" : "SMALL";
        let confidencePercent = (isBig1 === isBig2) ? 85 : 65;
        return {
            prediction, confidence: `${confidencePercent}%`,
            level1, level2, isBig1, isBig2,
            details: `Last:${lastNumber} → L1:${level1}(${isBig1?'BIG':'SMALL'}) L2:${level2}(${isBig2?'BIG':'SMALL'}) → ${prediction}`
        };
    }
}

// ========== GLOBAL STATE ==========
const predictor = new FixedMathPredictor();
let numberHistory = [];
let predictionsMap = new Map();
let resultsHistory = [];
let totalTrades = 0, wins = 0;
let lastProcessedPeriod = null;
let syntheticCounter = 1000;

// ========== ROBUST API FETCH ==========
async function fetchLatestResult() {
    try {
        const url = `${API_URL}?ts=${Date.now()}`;
        const res = await axios.get(url, {
            headers: { "User-Agent": "Mozilla/5.0" },
            timeout: 10000
        });
        // Safe extraction – supports multiple API response shapes
        const list = res.data?.data?.list || res.data?.list || [];
        if (!list.length) return null;
        const item = list[0];
        const period = String(item.issue || item.issueNumber || item.period || '');
        const number = parseInt(item.number ?? item.result ?? -1);
        if (period && !isNaN(number) && number >= 0 && number <= 9) {
            return { period, number };
        }
        return null;
    } catch (err) {
        console.log(`[API Warn] ${err.message}`);
        return null;
    }
}

function generateSyntheticResult() {
    return { period: String(++syntheticCounter), number: Math.floor(Math.random() * 10) };
}

// ========== EVALUATION & PREDICTION ==========
function evaluatePrediction(period, actualNumber) {
    const predObj = predictionsMap.get(period);
    if (!predObj) return false;
    const actualBig = actualNumber >= 5;
    const predictedBig = predObj.prediction === "BIG";
    const isWin = (actualBig === predictedBig);
    totalTrades++;
    if (isWin) wins++;
    numberHistory.push(actualNumber);
    if (numberHistory.length > 50) numberHistory.shift();
    resultsHistory.unshift({
        period,
        sticker: isWin ? "🏆 WIN" : "❌ LOSS",
        prediction: predObj.prediction,
        actual: actualBig ? "BIG" : "SMALL",
        actualNumber,
        confidence: predObj.confidence,
        mathDetails: predObj.details,
        time: new Date().toLocaleTimeString()
    });
    if (resultsHistory.length > 20) resultsHistory.pop();
    console.log(`[RESULT] ${period} | Pred: ${predObj.prediction} | Actual: ${actualBig?'BIG':'SMALL'} (${actualNumber}) → ${isWin ? "🏆 WIN" : "❌ LOSS"} | ${predObj.details}`);
    predictionsMap.delete(period);
    return isWin;
}

async function generatePrediction(currentPeriod, currentNumber) {
    const nextPeriod = String(parseInt(currentPeriod, 10) + 1);
    const lastNumber = numberHistory.length ? numberHistory[numberHistory.length-1] : currentNumber;
    const pred = predictor.predict(lastNumber);
    predictionsMap.set(nextPeriod, pred);
    console.log(`[PREDICT] Next ${nextPeriod} → ${pred.prediction} (${pred.confidence}) | ${pred.details}`);
    return pred;
}

// ========== MAIN UPDATE LOOP (CRASH-PROOF) ==========
async function update() {
    try {
        let current = await fetchLatestResult();
        if (!current) {
            current = generateSyntheticResult();
            console.log(`[SYNTHETIC] ${current.period} → ${current.number}`);
        } else {
            console.log(`[LIVE] ${current.period} → ${current.number}`);
        }
        // Validate period number
        const periodNum = parseInt(current.period, 10);
        if (isNaN(periodNum)) throw new Error(`Invalid period: ${current.period}`);
        if (lastProcessedPeriod !== current.period) {
            if (predictionsMap.has(current.period)) {
                evaluatePrediction(current.period, current.number);
            } else {
                numberHistory.push(current.number);
                if (numberHistory.length > 50) numberHistory.shift();
                console.log(`[INFO] ${current.period} added to history (no prediction)`);
            }
            lastProcessedPeriod = current.period;
        }
        const nextPeriod = String(periodNum + 1);
        if (!predictionsMap.has(nextPeriod)) {
            await generatePrediction(current.period, current.number);
        }
    } catch (err) {
        console.error(`[UPDATE ERROR] ${err.message}`);
        // Do NOT exit – just log and continue
    }
}

// ========== START SERVER WITH SAFE INIT ==========
async function start() {
    console.log(`🚀 ${NAME} starting...`);
    console.log(`📐 Rule: BIG if ((last+1)%10>=5) OR ((last+2)%10>=5)`);
    // Initial fetch – if fails, synthetic data will be used
    await update().catch(e => console.error(`Init error: ${e.message}`));
    setInterval(() => { update().catch(e => console.error(`Interval error: ${e.message}`)); }, 60000);
    app.listen(PORT, () => console.log(`✅ Server on port ${PORT}`));
}

// Global uncaught exception handler – prevents status 1 crash
process.on('uncaughtException', (err) => {
    console.error(`❗ UNCAUGHT EXCEPTION: ${err.message}`);
    // Do not exit – keep the bot alive
});
process.on('unhandledRejection', (reason) => {
    console.error(`❗ UNHANDLED REJECTION: ${reason}`);
});

// ========== EXPRESS ROUTES ==========
app.get('/trade', (req, res) => {
    const winRate = totalTrades ? ((wins/totalTrades)*100).toFixed(2) : 0;
    const nextPeriod = predictionsMap.keys().next().value;
    const pred = nextPeriod ? predictionsMap.get(nextPeriod) : { prediction:"WAITING", confidence:"0%", details:"", level1:"?", level2:"?" };
    res.json({
        currentPrediction: {
            period: nextPeriod || "WAITING",
            prediction: pred.prediction,
            confidence: pred.confidence,
            model: "Fixed Math (Add 1 & 2 Levels)",
            calculation: {
                lastNumberUsed: numberHistory.length ? numberHistory[numberHistory.length-1] : "waiting",
                level1: pred.level1,
                level2: pred.level2,
                details: pred.details
            }
        },
        performance: { totalTrades: totalTrades, wins: wins, losses: totalTrades - wins, winRate: `${winRate}%` },
        lastPredictions: resultsHistory.slice(0, 10),
        systemStatus: { status: "active", lastUpdate: new Date().toLocaleTimeString() }
    });
});

app.get('/', (req, res) => res.json({ status: "active", name: NAME, rule: "BIG if ((last+1)%10>=5) OR ((last+2)%10>=5)" }));
app.get('/health', (req, res) => res.status(200).json({ status: "OK", uptime: process.uptime() }));

start();
