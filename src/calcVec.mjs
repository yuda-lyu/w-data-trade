import isNumber from 'lodash-es/isNumber.js'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'
import pickValue from './pickValue.mjs'


let calcVec = (() => {

    // import w from 'wsemi'


    let kp = {
        '4hr': 1,
        '8hr': 2,
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

    let caVec = (vs, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

        //norm
        let norm = get(opt, 'norm', false)

        //n
        let n = size(vs)

        //check
        if (n < len) {
            return []
        }

        //rs
        let rs = []
        for (let i = len; i < n; i++) {

            //i0, i1
            let i0 = i - len
            let i1 = i
            // console.log('i0', i0, 'i1', i1)
            // console.log('vs[i0]', vs[i0])
            // console.log('vs[i1]', vs[i1])

            //vec
            let vec = vs[i1].value - vs[i0].value //後(現在)-前(前次), 雖用速度vec符號但不同時距皆視為1, 故vec僅為前後差值, 若值>0代表增加趨勢, 反之為降低趨勢
            // console.log('vec', vec)

            //ratioVec
            let ratioVec = 0
            if (vs[i1].value !== 0) {
                ratioVec = vec / vs[i1].value //對此刻值正規化
            }
            // console.log('ratioVec', ratioVec)

            //param
            let param = vec
            if (norm) {
                param = ratioVec
            }

            //r
            let r = {
                time: vs[i1].time,
                param,
            }

            //push
            rs.push(r)

        }

        return rs
    }

    let caVecs = (vs, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caVec
            let rs = caVec(vs, len, opt)

            //push
            rrs.push({
                period,
                len,
                vs: rs,
            })

        })

        return rrs
    }

    let calcVec = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,"Volumn":4657.972543,"CloseTime":"2020-01-01T03:59:59","QuoteAssetVolume":33441599.81960844,"NumberOfTrades":46046,"TakerBuyBaseAssetVolume":2161.591103,"TakerBuyQuoteAssetVolume":15520451.66291961},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,"Volumn":2091.720176,"CloseTime":"2020-01-01T07:59:59","QuoteAssetVolume":15032938.06298061,"NumberOfTrades":29738,"TakerBuyBaseAssetVolume":1010.628114,"TakerBuyQuoteAssetVolume":7263338.98247078},
        //   {"time":"2020-01-01T08:00:00","Open":7195.24,"High":7245,"Low":7175.46,"Close":7225.01,"Volumn":2833.74918,"CloseTime":"2020-01-01T11:59:59","QuoteAssetVolume":20445895.8017956,"NumberOfTrades":32476,"TakerBuyBaseAssetVolume":1548.865619,"TakerBuyQuoteAssetVolume":11176594.41972043},
        //   {"time":"2020-01-01T12:00:00","Open":7225,"High":7236.27,"Low":7199.11,"Close":7209.83,"Volumn":2061.295051,"CloseTime":"2020-01-01T15:59:59","QuoteAssetVolume":14890182.27509305,"NumberOfTrades":29991,"TakerBuyBaseAssetVolume":1049.711236,"TakerBuyQuoteAssetVolume":7582850.37593562},
        //   ...
        // ]

        //pickValue
        let vs = pickValue(arr, key) //轉為 { time, value }

        //caVecs
        let rs = caVecs(vs, opt)

        return rs
    }

    return calcVec
})()


export default calcVec
