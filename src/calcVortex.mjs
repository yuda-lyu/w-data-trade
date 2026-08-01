import isNumber from 'lodash-es/isNumber.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'


let calcVortex = (() => {

    // import w from 'wsemi'
    // import pickValue from './pickValue.mjs'


    let kp = {
        '12hr': 3,
        '16hr': 4,
        '20hr': 5,
        '1day': 6, // 1 day = 6 * 4 hours
        '2day': 12, // 2 days = 12 * 4 hours
        '4day': 24, // 4 days = 24 * 4 hours
        '7day': 42, // 7 days = 42 * 4 hours
    }

    let caVortex = (arr, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

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

        //用running sum維持 period 內 sum(VM+), sum(VM-), sum(TR)
        let sumVp = 0 //sum(VM+)
        let sumVm = 0 //sum(VM-)
        let sumTr = 0 //sum(TR)

        //暫存每根的 vm+/vm-/tr 以便視窗滑動時扣掉最舊那根, 取用索引i代表「第i根K所計算的量」(需要i-1)
        let vps = new Array(n).fill(0)
        let vms = new Array(n).fill(0)
        let trs = new Array(n).fill(0)

        //rs
        let rs = []
        for (let i = 1; i < n; i++) {

            let h = arr[i][kHigh]
            let l = arr[i][kLow]
            let cPrev = arr[i - 1][kClose]
            let hPrev = arr[i - 1][kHigh]
            let lPrev = arr[i - 1][kLow]

            //check
            if (!isNumber(h)) {
                throw new Error(`invalid h[${h}]`)
            }
            if (!isNumber(l)) {
                throw new Error(`invalid l[${l}]`)
            }
            if (!isNumber(cPrev)) {
                throw new Error(`invalid cPrev[${cPrev}]`)
            }
            if (!isNumber(hPrev)) {
                throw new Error(`invalid hPrev[${hPrev}]`)
            }
            if (!isNumber(lPrev)) {
                throw new Error(`invalid lPrev[${lPrev}]`)
            }

            //VM+ / VM-
            let vp = Math.abs(h - lPrev)
            let vm = Math.abs(l - hPrev)

            //TR
            let tr1 = Math.abs(h - l)
            let tr2 = Math.abs(h - cPrev)
            let tr3 = Math.abs(l - cPrev)
            let tr = Math.max(tr1, tr2, tr3)

            vps[i] = vp
            vms[i] = vm
            trs[i] = tr

            //加入running sum
            sumVp += vp
            sumVm += vm
            sumTr += tr

            //維護視窗大小, 視窗涵蓋的指標是(i-len+1)至i, 所以移動視窗後皆要扣掉已超出視窗的前1個也就是(i-len)位置的值, 且因為計算量從i=1才開始, 故使用idxDrop>=1
            let idxDrop = i - len
            if (idxDrop >= 1) {
                sumVp -= vps[idxDrop]
                sumVm -= vms[idxDrop]
                sumTr -= trs[idxDrop]
            }

            //check, 視窗未滿len, 需要累積到i>=len才有len根量
            if (i < len) {
                continue
            }

            //VI+ / VI-
            let VIplus = null
            let VIminus = null
            if (sumTr === 0) {
                //極端情況，避免除以0
                VIplus = 0
                VIminus = 0
            }
            else {
                VIplus = sumVp / sumTr
                VIminus = sumVm / sumTr
            }

            //push
            rs.push({
                time: arr[i][kTime],
                VIplus,
                VIminus,
                VIdiff: VIplus - VIminus,
                VIsum: VIplus + VIminus,
            })

        }
        // console.log('rs', rs)

        return rs
    }

    let caVortexs = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caVortex
            let rs = caVortex(arr, len, opt)

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

    let calcVortex = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,"Volumn":4657.972543,"CloseTime":"2020-01-01T03:59:59","QuoteAssetVolume":33441599.81960844,"NumberOfTrades":46046,"TakerBuyBaseAssetVolume":2161.591103,"TakerBuyQuoteAssetVolume":15520451.66291961},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,"Volumn":2091.720176,"CloseTime":"2020-01-01T07:59:59","QuoteAssetVolume":15032938.06298061,"NumberOfTrades":29738,"TakerBuyBaseAssetVolume":1010.628114,"TakerBuyQuoteAssetVolume":7263338.98247078},
        //   {"time":"2020-01-01T08:00:00","Open":7195.24,"High":7245,"Low":7175.46,"Close":7225.01,"Volumn":2833.74918,"CloseTime":"2020-01-01T11:59:59","QuoteAssetVolume":20445895.8017956,"NumberOfTrades":32476,"TakerBuyBaseAssetVolume":1548.865619,"TakerBuyQuoteAssetVolume":11176594.41972043},
        //   {"time":"2020-01-01T12:00:00","Open":7225,"High":7236.27,"Low":7199.11,"Close":7209.83,"Volumn":2061.295051,"CloseTime":"2020-01-01T15:59:59","QuoteAssetVolume":14890182.27509305,"NumberOfTrades":29991,"TakerBuyBaseAssetVolume":1049.711236,"TakerBuyQuoteAssetVolume":7582850.37593562},
        //   ...
        // ]

        // //pickValue
        // let vs = pickValue(arr, key) //轉為 { time, value }

        //caVortexs
        let rs = caVortexs(arr, opt)

        return rs
    }

    return calcVortex
})()


export default calcVortex
