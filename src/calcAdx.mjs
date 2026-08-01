import isNumber from 'lodash-es/isNumber.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'


let calcAdx = (() => {

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

    let caAdx = (arr, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

        //n
        let n = size(arr)

        //check, 需要2*len根(第一次平滑len + 第二次平滑ADX len)再加上i=1起算
        if (n < 2 * len + 1) {
            return []
        }

        let kTime = 'time'
        let kHigh = 'High'
        let kLow = 'Low'
        let kClose = 'Close'

        //計算每根的+DM, -DM, TR(從i=1開始)
        let pdms = new Array(n).fill(0) // +DM
        let ndms = new Array(n).fill(0) // -DM
        let trs = new Array(n).fill(0) // TR
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

            //+DM / -DM
            let upMove = h - hPrev
            let downMove = lPrev - l
            if (upMove > downMove && upMove > 0) {
                pdms[i] = upMove
            }
            if (downMove > upMove && downMove > 0) {
                ndms[i] = downMove
            }

            //TR
            let tr1 = Math.abs(h - l)
            let tr2 = Math.abs(h - cPrev)
            let tr3 = Math.abs(l - cPrev)
            trs[i] = Math.max(tr1, tr2, tr3)

        }

        //第一次Wilder's平滑: 種子用SMA(1至len)
        let sumPdm = 0
        let sumNdm = 0
        let sumTr = 0
        for (let i = 1; i <= len; i++) {
            sumPdm += pdms[i]
            sumNdm += ndms[i]
            sumTr += trs[i]
        }
        let smoothPdm = sumPdm / len
        let smoothNdm = sumNdm / len
        let smoothTr = sumTr / len

        //計算+DI, -DI, DX序列(從index=len開始)
        let dxVals = []
        let diData = [] // 暫存{plusDI, minusDI}用於輸出

        //index=len的第一筆
        {
            let plusDI = smoothTr !== 0 ? 100 * smoothPdm / smoothTr : 0
            let minusDI = smoothTr !== 0 ? 100 * smoothNdm / smoothTr : 0
            let diSum = plusDI + minusDI
            let DX = diSum !== 0 ? 100 * Math.abs(plusDI - minusDI) / diSum : 0
            dxVals.push(DX)
            diData.push({ idx: len, plusDI, minusDI })
        }

        //index=len+1至n-1, 持續Wilder's平滑
        for (let i = len + 1; i < n; i++) {
            smoothPdm = (smoothPdm * (len - 1) + pdms[i]) / len
            smoothNdm = (smoothNdm * (len - 1) + ndms[i]) / len
            smoothTr = (smoothTr * (len - 1) + trs[i]) / len

            let plusDI = smoothTr !== 0 ? 100 * smoothPdm / smoothTr : 0
            let minusDI = smoothTr !== 0 ? 100 * smoothNdm / smoothTr : 0
            let diSum = plusDI + minusDI
            let DX = diSum !== 0 ? 100 * Math.abs(plusDI - minusDI) / diSum : 0
            dxVals.push(DX)
            diData.push({ idx: i, plusDI, minusDI })
        }

        //第二次Wilder's平滑: ADX = smooth(DX, len)
        //種子: SMA of first len DX values
        let sumDx = 0
        for (let j = 0; j < len; j++) {
            sumDx += dxVals[j]
        }
        let adxPrev = sumDx / len

        //rs
        let rs = []

        //第一筆ADX(對應diData[len-1], arr index = len + len - 1 = 2*len - 1... 不對)
        //dxVals[0]對應arr index=len, dxVals[len-1]對應arr index=2*len-1
        //ADX種子用dxVals[0..len-1]的SMA, 對應arr index = 2*len-1
        {
            let d = diData[len - 1]
            let ADX = adxPrev
            rs.push({
                time: arr[d.idx][kTime],
                ADX,
                plusDI: d.plusDI,
                minusDI: d.minusDI,
                DIcross: d.plusDI - d.minusDI,
                ADXslope: 0, //第一筆無前值
            })
        }

        //後續ADX
        for (let j = len; j < dxVals.length; j++) {
            let adx = (adxPrev * (len - 1) + dxVals[j]) / len
            let d = diData[j]
            rs.push({
                time: arr[d.idx][kTime],
                ADX: adx,
                plusDI: d.plusDI,
                minusDI: d.minusDI,
                DIcross: d.plusDI - d.minusDI,
                ADXslope: adx - adxPrev,
            })
            adxPrev = adx
        }
        // console.log('rs', rs)

        return rs
    }

    let caAdxs = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caAdx
            let rs = caAdx(arr, len, opt)

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

    let calcAdx = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,...},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,...},
        //   ...
        // ]

        //caAdxs
        let rs = caAdxs(arr, opt)

        return rs
    }

    return calcAdx
})()


export default calcAdx
