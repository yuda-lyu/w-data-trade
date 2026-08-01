import isNumber from 'lodash-es/isNumber.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'


let calcAts = (() => {

    //ATS (Average Trade Size) = QuoteAssetVolume / NumberOfTrades = 平均單筆成交額 (USDT)
    //反映「大戶介入 vs 散戶 FOMO」之單筆規模維度, 與既有 volumn 系列完全互補
    //
    //len = baseline SMA 視窗期數 (n × 4hr)
    //atsRatio  = ats[i] / SMA(ats, len)       (相對 N 期均值倍數, 跨時期可比, 對應 d12 vol_volumeSpike 的 atsSpike)
    //atsChange = (ats[i] - ats[i-1]) / ats[i-1]  (相對前一根%變化, 抓突發大單事件)
    let kp = {
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

    let caAts = (arr, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

        //n
        let n = size(arr)

        //check, 需 len 根供 SMA baseline + 至少 1 根算 atsChange
        if (n < len + 1) {
            return []
        }

        let kTime = 'time'
        let kQuoteVol = 'QuoteAssetVolume'
        let kNumTrades = 'NumberOfTrades'

        //計算各根 raw ATS
        //nt=0 時 ats=0 (d12 行為; ETH 4hr 不會踩到, 防呆而已)
        let atss = new Array(n).fill(0)
        for (let i = 0; i < n; i++) {
            let qv = arr[i][kQuoteVol]
            let nt = arr[i][kNumTrades]

            //check
            if (!isNumber(qv)) {
                throw new Error(`invalid qv[${qv}]`)
            }
            if (!isNumber(nt)) {
                throw new Error(`invalid nt[${nt}]`)
            }

            if (nt > 0) {
                atss[i] = qv / nt
            }
            //else: atss[i] = 0 (預設值)
        }

        //rolling SMA baseline (視窗 [i-len+1, i] 之 ATS 均值)
        //running sum 維護, 第一個 baseline 對應 index = len-1
        let sumAts = 0
        for (let i = 0; i < len; i++) {
            sumAts += atss[i]
        }

        //rs
        let rs = []

        //第一筆 atsRatio 對應 index = len-1, atsChange 對應 index = len-1 (需 len-2 之前根存在)
        {
            let i = len - 1
            let ats = atss[i]
            let baseline = sumAts / len
            let atsRatio = baseline !== 0 ? ats / baseline : 1
            let atsPrev = atss[i - 1]
            let atsChange = atsPrev !== 0 ? (ats - atsPrev) / atsPrev : 0

            rs.push({
                time: arr[i][kTime],
                atsRatio,
                atsChange,
            })
        }

        //後續 i >= len
        for (let i = len; i < n; i++) {
            //視窗滑動: 排掉 i-len, 加上 i
            sumAts = sumAts - atss[i - len] + atss[i]

            let ats = atss[i]
            let baseline = sumAts / len
            let atsRatio = baseline !== 0 ? ats / baseline : 1

            let atsPrev = atss[i - 1]
            let atsChange = atsPrev !== 0 ? (ats - atsPrev) / atsPrev : 0

            rs.push({
                time: arr[i][kTime],
                atsRatio,
                atsChange,
            })
        }
        // console.log('rs', rs)

        return rs
    }

    let caAtss = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caAts
            let rs = caAts(arr, len, opt)

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

    let calcAts = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00",...,"QuoteAssetVolume":33441599.81960844,"NumberOfTrades":46046,...},
        //   ...
        // ]

        //caAtss
        let rs = caAtss(arr, opt)

        return rs
    }

    return calcAts
})()


export default calcAts
