import isNumber from 'lodash-es/isNumber.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'
import resolvePeriods from './resolvePeriods.mjs'


/**
 * 計算各週期之CVD(Cumulative Volume Delta，累積量能差)
 *
 * delta(i)=(2*TakerBuyBaseAssetVolume(i)-Volumn(i))/Volumn(i)，Volumn(i)小於等於0時delta回0
 * cvd為視窗[i-len+1,i]內delta加總後除以√len之歸一化累積值，第一筆對應輸入索引len-1
 * cvdSlope=(cvd(i)-cvd(i-3))/3，固定回看3根(對應12hr)以呈現累積動能之變化速度
 * 資料筆數n小於len+3時該期vs回空陣列
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-trade/blob/master/test/unit-calcCvd.test.mjs Github}
 * @function
 * @param {Array} arr 輸入K線陣列，各元素需含time、Volumn、TakerBuyBaseAssetVolume欄位
 * @param {String} key 輸入計算所用數值欄位名稱字串，本指標固定讀取Volumn/TakerBuyBaseAssetVolume欄位，key目前未被使用，僅為與其他指標介面一致而保留
 * @param {Object} [opt={}] 輸入設定物件，預設{}，除下列週期換算相關鍵外本指標無其他可用設定鍵
 * @param {Number|String} [opt.barsPerDay=6] 輸入每日K線根數，有效數字(大於0且至多86400)，各期根數依此自4hr基準(每日6根)等比換算並四捨五入，換算後不足1根之期剔除，預設6(不換算)，非預期之輸入視為未給
 * @param {Object} [opt.kp] 輸入直接採用之週期表物件，鍵為週期標籤，值為正整數根數或參數物件，給予時不換算，預設採內建週期表，非預期之輸入視為未給
 * @param {Boolean} [opt.debug=false] 輸入是否於opt.barsPerDay或opt.kp出現非預期輸入時輸出警告布林值，預設false
 * @param {Function} [opt.funLog] 輸入警告出口函數，以(msg, { fn, reason, key })呼叫，未給則用console.warn，預設未給
 * @returns {Promise} 回傳Promise，resolve為各期結果陣列，各元素為{period,len,vs}，vs內各元素為{time,cvd,cvdSlope}
 * @example
 *
 * let arr = [
 *     { time: '2020-01-01T00:00:00', Volumn: 1000, TakerBuyBaseAssetVolume: 600 },
 *     { time: '2020-01-01T04:00:00', Volumn: 1200, TakerBuyBaseAssetVolume: 500 },
 *     { time: '2020-01-01T08:00:00', Volumn: 900, TakerBuyBaseAssetVolume: 400 },
 *     { time: '2020-01-01T12:00:00', Volumn: 1100, TakerBuyBaseAssetVolume: 700 },
 *     { time: '2020-01-01T16:00:00', Volumn: 1300, TakerBuyBaseAssetVolume: 800 },
 *     { time: '2020-01-01T20:00:00', Volumn: 1000, TakerBuyBaseAssetVolume: 450 },
 *     { time: '2020-01-02T00:00:00', Volumn: 1050, TakerBuyBaseAssetVolume: 600 },
 * ]
 *
 * calcCvd(arr, 'Close')
 *     .then((rs) => {
 *         console.log(rs[0])
 *         // => {
 *         //   period: '12hr',
 *         //   len: 3,
 *         //   vs: [
 *         //     { time: '2020-01-01T20:00:00', cvd: 0.23295881491077913, cvdSlope: 0.09262127861591667 },
 *         //     { time: '2020-01-02T00:00:00', cvd: 0.15797826047056798, cvdSlope: 0.053631390307006886 }
 *         //   ]
 *         // }
 *     })
 *
 */
let calcCvd = (() => {

    //Rolling CVD 各 period 對應 len (4hr K 線)
    //len = rolling 累積期數 (n × 4hr)
    //cvd        = Σ deltaNorm[j], j ∈ [i-len+1, i]   (rolling 累積主動買賣淨壓)
    //cvdSlope   = (cvd[i] - cvd[i-slopeN]) / slopeN  (累積動能斜率)
    let KP = { //內建週期表(以4hr K線為基準: 每日6根), 實際週期表由resolvePeriods依opt.barsPerDay或opt.kp換算
        '12hr': 3,
        '16hr': 4,
        '20hr': 5,
        '1day': 6,
        '2day': 12,
        '4day': 24,
        '7day': 42,
        '15day': 90,
        '30day': 180,
    }

    //slope 回看根數: 固定 3 (= 12hr), 與 cvd 形成 fast/slow 對比
    //cvd 反映「累積位置」, cvdSlope 反映「最近 12hr 變化速度」, 兩者組合給 DE 完整訂單流動能視角
    let SLOPE_N = 3

    let caCvd = (arr, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

        //n
        let n = size(arr)

        //check, 需 len + SLOPE_N 根: 前 len 根供初始 cvd 累加, 再 SLOPE_N 根供 slope 計算
        if (n < len + SLOPE_N) {
            return []
        }

        let kTime = 'time'
        let kVolumn = 'Volumn'
        let kTakerBuy = 'TakerBuyBaseAssetVolume'

        //計算各根 deltaNorm = (2*TakerBuy - Volume) / Volume; vol=0 時 delta=0 (d12 行為)
        //不沿用既有 vbs 的 dv 防呆 (vol=0 時塞 0.00001 會讓 delta 爆炸 outlier 拉大 std, 破壞 z-score)
        let deltas = new Array(n).fill(0)
        for (let i = 0; i < n; i++) {
            let vol = arr[i][kVolumn]
            let tb = arr[i][kTakerBuy]

            //check
            if (!isNumber(vol)) {
                throw new Error(`invalid vol[${vol}]`)
            }
            if (!isNumber(tb)) {
                throw new Error(`invalid tb[${tb}]`)
            }

            if (vol > 0) {
                deltas[i] = (2 * tb - vol) / vol
            }
            //else: deltas[i] = 0 (vol=0 不貢獻, 避免 outlier)
        }

        //rolling sum 維護視窗 cvd, 並做 /√len 歸一化
        //
        //【為何 /√len】純 sum 的 std ∝ N^p (實測 p≈0.68, vdr 有自相關), 不同 period z-score 後子集 std 差 16 倍
        //  DE 搜門檻 ±1 在短 N 抓不到、長 N 太鬆.
        //  /√len 是「累積 sum」與「平均 average」的 sweet spot:
        //    - 保留累積精神 (不變 average, 否則跟既有 vdr_maNorm 重複)
        //    - 部分歸一化 (跨 period 子集 std 差距由 16 倍 → ~2 倍)
        //  cvd_norm = (Σ delta) / √len
        //
        //視窗 [i-len+1, i], 第一個 cvd 對應 index = len-1
        let cvds = new Array(n).fill(null)
        let sqrtLen = Math.sqrt(len)
        let sumDelta = 0
        for (let i = 0; i < len; i++) {
            sumDelta += deltas[i]
        }
        cvds[len - 1] = sumDelta / sqrtLen

        for (let i = len; i < n; i++) {
            //視窗滑動: 排掉 i-len, 加上 i
            sumDelta = sumDelta - deltas[i - len] + deltas[i]
            cvds[i] = sumDelta / sqrtLen
        }

        //計算 slope, 起始 index = len-1+SLOPE_N (cvd 已 ready 且有 slopeN 個歷史)
        let rs = []
        let startIdx = len - 1 + SLOPE_N
        for (let i = startIdx; i < n; i++) {
            let cvd = cvds[i]
            let cvdPrev = cvds[i - SLOPE_N]
            let cvdSlope = (cvd - cvdPrev) / SLOPE_N

            rs.push({
                time: arr[i][kTime],
                cvd,
                cvdSlope,
            })
        }
        // console.log('rs', rs)

        return rs
    }

    let caCvds = (arr, opt = {}) => {

        //kp, 週期表(預設不換算; opt.barsPerDay給每日根數即等比換算, opt.kp直接覆寫)
        let kp = resolvePeriods(KP, opt)

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caCvd
            let rs = caCvd(arr, len, opt)

            //push
            rrs.push({
                period,
                len,
                vs: rs,
            })
            // console.log('rrs', rrs)

        })

        return rrs
    }

    let calcCvd = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,...,"Volumn":4657.972543,...,"TakerBuyBaseAssetVolume":2161.591103,...},
        //   ...
        // ]

        //caCvds
        let rs = caCvds(arr, opt)

        return rs
    }

    return calcCvd
})()


export default calcCvd
