import isNumber from 'lodash-es/isNumber.js'
import size from 'lodash-es/size.js'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import pickValue from './pickValue.mjs'
import caEma from './caEma.mjs'


let calcMacd = (() => {

    // import w from 'wsemi'


    let kp = {
        '4hr': 1,
        '8hr': 2,
        '12hr': 3,
        '16hr': 4,
        '20hr': 5,
        '1day': 6, // 1 day = 6 * 4 hours, 若1day, 此時MACD的26根k線代表26日
    }

    let caMacd = (arr, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

        //n
        let n = size(arr)

        //check
        if (n < len) {
            return []
        }

        let kTime = 'time'
        // let kHigh = 'High'
        // let kLow = 'Low'
        let kClose = 'Close'

        //pickValue
        let vs = pickValue(arr, kClose) //轉為 { time, value }

        //params, base by standard MACD(12, 26, 9)
        let fastPeriod = Math.floor(len * 12)
        let slowPeriod = Math.floor(len * 26)
        let signalPeriod = Math.floor(len * 9)

        //check
        if (n < slowPeriod + signalPeriod - 1) {
            return []
        }

        //ensure
        if (slowPeriod <= fastPeriod) slowPeriod = fastPeriod + 1
        if (signalPeriod < 1) signalPeriod = 1
        // console.log('fastPeriod', fastPeriod)
        // console.log('slowPeriod', slowPeriod)
        // console.log('signalPeriod', signalPeriod)
        // console.log('n', n)

        //Fast EMA
        let emasFast = caEma(vs, fastPeriod, { norm: false })
        // console.log('emasFast', last(emasFast), size(emasFast), n)

        //Slow EMA
        let emasSlow = caEma(vs, slowPeriod, { norm: false })
        // console.log('emasSlow', last(emasSlow), size(emasSlow), n)

        //firstFastIndex, firstSlowIndex
        let firstFastIndex = (fastPeriod - 1)
        let firstSlowIndex = (slowPeriod - 1)

        //difs(Fast-Slow)
        let difs = []
        for (let i = slowPeriod - 1; i < n; i++) {

            //t
            let t = get(vs, `${i}.${kTime}`, null)
            // console.log('t', t)

            //f
            let f = null
            if (i >= firstFastIndex) {
                f = get(emasFast, `${i - firstFastIndex}.param`, null)
            }
            // console.log('f', f)

            //s
            let s = null
            if (i >= firstSlowIndex) {
                s = get(emasSlow, `${i - firstSlowIndex}.param`, null)
            }
            // console.log('s', s)

            //push
            if (isNumber(f) && isNumber(s)) {
                let v = f - s
                difs.push({
                    time: t,
                    value: v,
                })
            }
            else {
                console.log('vs', vs)
                console.log('i', i)
                console.log('f', f)
                console.log('s', s)
                throw new Error(`invalid data`)
            }

        }
        // console.log('difs', last(difs), size(difs), n)

        //dems
        let dems = caEma(difs, signalPeriod, { norm: false })
        // console.log('dems', last(dems), size(dems), n)

        //firstDifIndex, firstDemIndex
        let firstDifIndex = slowPeriod - 1
        let firstDemIndex = (slowPeriod - 1) + (signalPeriod - 1)

        //rs
        let rs = []
        for (let i = 0; i < n; i++) {

            //t
            let t = get(vs, `${i}.time`, null)
            // console.log('t', t)

            //dif
            let dif = null
            if (i >= firstDifIndex) {
                dif = get(difs, `${i - firstDifIndex}.value`, null)
            }
            // console.log('dif', dif)

            //dem
            let dem = null
            if (i >= firstDemIndex) {
                dem = get(dems, `${i - firstDemIndex}.param`, null)
            }
            // console.log('dmf', dem)

            //osc
            let osc = null // Histogram (Bar)
            if (isNumber(dif) && isNumber(dem)) {
                osc = dif - dem
            }
            // console.log('osc', osc)

            //DIF: 快線, 趨勢有沒有開始動
            //DEM(DEA): 慢線, 趨勢有沒有被確認
            //OSC(MACD柱狀): 動能, 兩者差距有多大
            if (isNumber(dif) && isNumber(dem) && isNumber(osc)) {
                rs.push({
                    time: t,
                    DIF: dif,
                    DEM: dem,
                    OSC: osc,
                })
            }

        }
        // console.log('rs', last(rs), size(rs), n)

        return rs
    }

    let caMacds = (vs, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caMacd
            let rs = caMacd(vs, len, opt)

            //push
            rrs.push({
                period,
                len,
                vs: rs,
            })

        })

        return rrs
    }

    let calcMacd = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,"Volumn":4657.972543,"CloseTime":"2020-01-01T03:59:59","QuoteAssetVolume":33441599.81960844,"NumberOfTrades":46046,"TakerBuyBaseAssetVolume":2161.591103,"TakerBuyQuoteAssetVolume":15520451.66291961},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,"Volumn":2091.720176,"CloseTime":"2020-01-01T07:59:59","QuoteAssetVolume":15032938.06298061,"NumberOfTrades":29738,"TakerBuyBaseAssetVolume":1010.628114,"TakerBuyQuoteAssetVolume":7263338.98247078},
        //   {"time":"2020-01-01T08:00:00","Open":7195.24,"High":7245,"Low":7175.46,"Close":7225.01,"Volumn":2833.74918,"CloseTime":"2020-01-01T11:59:59","QuoteAssetVolume":20445895.8017956,"NumberOfTrades":32476,"TakerBuyBaseAssetVolume":1548.865619,"TakerBuyQuoteAssetVolume":11176594.41972043},
        //   {"time":"2020-01-01T12:00:00","Open":7225,"High":7236.27,"Low":7199.11,"Close":7209.83,"Volumn":2061.295051,"CloseTime":"2020-01-01T15:59:59","QuoteAssetVolume":14890182.27509305,"NumberOfTrades":29991,"TakerBuyBaseAssetVolume":1049.711236,"TakerBuyQuoteAssetVolume":7582850.37593562},
        //   ...
        // ]

        // //pickValue
        // let vs = pickValue(arr, key) //轉為 { time, value }

        //caMacds
        let rs = caMacds(arr, opt)

        return rs
    }

    return calcMacd
})()


export default calcMacd
