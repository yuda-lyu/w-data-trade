import isNumber from 'lodash-es/isNumber.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'


let calcObv = (() => {

    let kp = {
        '12hr': 3,
        '16hr': 4,
        '20hr': 5,
        '1day': 6, // 1 day = 6 * 4 hours
        '2day': 12, // 2 days = 12 * 4 hours
        '4day': 24, // 4 days = 24 * 4 hours
        '7day': 42, // 7 days = 42 * 4 hours
        '15day': 90, // 15 days = 90 * 4 hours
        '30day': 180, // 30 days = 180 * 4 hours
    }

    let caObv = (arr, len, opt = {}) => {

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
        let kClose = 'Close'
        let kVolumn = 'Volumn'

        //計算累積OBV序列
        let obvs = new Array(n).fill(0)
        obvs[0] = 0
        for (let i = 1; i < n; i++) {

            let c = arr[i][kClose]
            let cPrev = arr[i - 1][kClose]
            let vol = arr[i][kVolumn]

            //check
            if (!isNumber(c)) {
                throw new Error(`invalid c[${c}]`)
            }
            if (!isNumber(cPrev)) {
                throw new Error(`invalid cPrev[${cPrev}]`)
            }
            if (!isNumber(vol)) {
                throw new Error(`invalid vol[${vol}]`)
            }

            //OBV累積
            if (c > cPrev) {
                obvs[i] = obvs[i - 1] + vol
            }
            else if (c < cPrev) {
                obvs[i] = obvs[i - 1] - vol
            }
            else {
                obvs[i] = obvs[i - 1]
            }

        }

        //用running sum計算OBV的SMA(period)
        let sumObv = 0

        //rs
        let rs = []
        for (let i = 1; i < n; i++) {

            //加入running sum
            sumObv += obvs[i]

            //維護視窗大小, 扣掉超出視窗的最舊值
            let idxDrop = i - len
            if (idxDrop >= 1) {
                sumObv -= obvs[idxDrop]
            }

            //check, 視窗未滿len(需要從i=1開始累積len根)
            if (i < len) {
                continue
            }

            //OBV_MA = SMA(OBV, period)
            let obvMa = sumObv / len

            //OBVnorm = (OBV - OBV_MA) / OBV_MA
            let OBVnorm = obvMa !== 0 ? (obvs[i] - obvMa) / Math.abs(obvMa) : 0

            //OBVslope = (OBV - OBV[i-len]) / len, 正規化用abs(OBV[i-len])避免尺度問題
            let obvPast = obvs[i - len]
            let OBVslope = 0
            if (Math.abs(obvPast) > 0) {
                OBVslope = (obvs[i] - obvPast) / (len * Math.abs(obvPast))
            }
            else {
                OBVslope = (obvs[i] - obvPast) / len
            }

            //OBVdiv: OBV方向 vs 價格方向, 1=同向, -1=背離, 0=無方向
            let obvDir = Math.sign(obvs[i] - obvPast)
            let priceDir = Math.sign(arr[i][kClose] - arr[i - len][kClose])
            let OBVdiv = 0
            if (obvDir !== 0 && priceDir !== 0) {
                OBVdiv = obvDir === priceDir ? 1 : -1
            }

            //push
            rs.push({
                time: arr[i][kTime],
                OBVnorm,
                OBVslope,
                OBVdiv,
            })

        }
        // console.log('rs', rs)

        return rs
    }

    let caObvs = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caObv
            let rs = caObv(arr, len, opt)

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

    let calcObv = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,"Volumn":4657.972543,...},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,"Volumn":2091.720176,...},
        //   ...
        // ]

        //caObvs
        let rs = caObvs(arr, opt)

        return rs
    }

    return calcObv
})()


export default calcObv
