import isNumber from 'lodash-es/isNumber.js'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'


let calcMfi = (() => {

    let kp = {
        '12hr': 3,
        '16hr': 4,
        '20hr': 5,
        '1day': 6, // 1 day = 6 * 4 hours
        '2day': 12, // 2 days = 12 * 4 hours
        '4day': 24, // 4 days = 24 * 4 hours
        '7day': 42, // 7 days = 42 * 4 hours
    }

    let caMfi = (arr, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

        //eps
        let eps = get(opt, 'eps', 1e-12)

        //n
        let n = size(arr)

        //check
        if (n < len + 1) {
            return []
        }

        let kTime = 'time'
        let kHigh = 'High'
        let kLow = 'Low'
        let kClose = 'Close'
        let kVolumn = 'Volumn'

        //計算每根的TP與Raw Money Flow, 並分類正負向(從i=1開始, 因需比較TP方向)
        let posMFs = new Array(n).fill(0)
        let negMFs = new Array(n).fill(0)
        let tps = new Array(n).fill(0)
        for (let i = 0; i < n; i++) {

            let h = arr[i][kHigh]
            let l = arr[i][kLow]
            let c = arr[i][kClose]
            let vol = arr[i][kVolumn]

            //check
            if (!isNumber(h)) {
                throw new Error(`invalid h[${h}]`)
            }
            if (!isNumber(l)) {
                throw new Error(`invalid l[${l}]`)
            }
            if (!isNumber(c)) {
                throw new Error(`invalid c[${c}]`)
            }
            if (!isNumber(vol)) {
                throw new Error(`invalid vol[${vol}]`)
            }

            //Typical Price
            let tp = (h + l + c) / 3
            tps[i] = tp

            //Raw Money Flow
            if (i >= 1) {
                let rawMF = tp * vol
                if (tp > tps[i - 1]) {
                    posMFs[i] = rawMF
                }
                else if (tp < tps[i - 1]) {
                    negMFs[i] = rawMF
                }
                //tp === tps[i-1] → 不計入任何一方
            }

        }

        //用running sum維持視窗內的正負向資金流
        let sumPosMF = 0
        let sumNegMF = 0

        //暫存MFI值用於計算MFIdiv
        let mfiVals = []

        //rs
        let rs = []
        for (let i = 1; i < n; i++) {

            //加入running sum
            sumPosMF += posMFs[i]
            sumNegMF += negMFs[i]

            //維護視窗大小, 扣掉超出視窗的最舊值
            let idxDrop = i - len
            if (idxDrop >= 1) {
                sumPosMF -= posMFs[idxDrop]
                sumNegMF -= negMFs[idxDrop]
            }

            //check, 視窗未滿len
            if (i < len) {
                mfiVals.push(null)
                continue
            }

            //MFI = 100 - 100 / (1 + Money Flow Ratio)
            let MFI
            if (sumNegMF <= eps && sumPosMF <= eps) {
                MFI = 50 //完全平盤
            }
            else if (sumNegMF <= eps) {
                MFI = 100 //全部正向
            }
            else if (sumPosMF <= eps) {
                MFI = 0 //全部負向
            }
            else {
                let mfRatio = sumPosMF / sumNegMF
                MFI = 100 - (100 / (1 + mfRatio))
            }

            //MFIdiv: MFI方向 vs 價格方向
            let MFIdiv = 0
            let mfiIdx = mfiVals.length - len
            if (mfiIdx >= 0 && mfiVals[mfiIdx] !== null) {
                let mfiDir = Math.sign(MFI - mfiVals[mfiIdx])
                let priceDir = Math.sign(arr[i][kClose] - arr[i - len][kClose])
                if (mfiDir !== 0 && priceDir !== 0) {
                    MFIdiv = mfiDir === priceDir ? 1 : -1
                }
            }

            mfiVals.push(MFI)

            //MFIratio: 正向資金流佔比 (0~1)
            let totalMF = sumPosMF + sumNegMF
            let MFIratio = totalMF > eps ? sumPosMF / totalMF : 0.5

            //push
            rs.push({
                time: arr[i][kTime],
                MFI,
                MFIratio,
                MFIdiv,
            })

        }
        // console.log('rs', rs)

        return rs
    }

    let caMfis = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caMfi
            let rs = caMfi(arr, len, opt)

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

    let calcMfi = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,"Volumn":4657.972543,...},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,"Volumn":2091.720176,...},
        //   ...
        // ]

        //caMfis
        let rs = caMfis(arr, opt)

        return rs
    }

    return calcMfi
})()


export default calcMfi
