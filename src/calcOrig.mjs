import map from 'lodash-es/map.js'


/**
 * 計算各週期之原始數值Orig(Original Value，逐筆直接複製輸入數值，不做任何運算)
 *
 * 僅逐筆對應輸入，不做視窗/累積運算，亦不篩選或檢查數值合法性；資料筆數與輸入相同，缺key欄位或非數值時param為undefined或原樣值，該筆仍保留
 * 固定回傳單一區塊，period為'none'，len為0
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-trade/blob/master/test/unit-calcOrig.test.mjs Github}
 * @function
 * @param {Array} arr 輸入K線陣列，各元素需含time與計算所用之數值欄位
 * @param {String} key 輸入計算所用數值欄位名稱字串，例如'Close'
 * @returns {Promise} 回傳Promise，resolve為單一結果陣列，元素為{period,len,vs}，period固定為'none'，len固定為0，vs內各元素為{time,param}
 * @example
 *
 * let arr = [
 *     { time: '2020-01-01T00:00:00', Close: 7173.32 },
 *     { time: '2020-01-01T04:00:00', Close: 7195.23 },
 *     { time: '2020-01-01T08:00:00', Close: 7225.01 },
 * ]
 *
 * calcOrig(arr, 'Close')
 *     .then((rs) => {
 *         console.log(rs[0])
 *         // => {
 *         //   period: 'none',
 *         //   len: 0,
 *         //   vs: [
 *         //     { time: '2020-01-01T00:00:00', param: 7173.32 },
 *         //     { time: '2020-01-01T04:00:00', param: 7195.23 },
 *         //     { time: '2020-01-01T08:00:00', param: 7225.01 }
 *         //   ]
 *         // }
 *     })
 *
 */
let calcOrig = (() => {

    // import w from 'wsemi'


    let calcOrig = async(arr, key) => {

        //rs
        let rs = map(arr, (v) => {
            return {
                time: v['time'],
                param: v[key], //統一參數名param, 提取Close做為param
            }
        })

        //rrs
        let rrs = [
            {
                period: 'none',
                len: 0,
                vs: rs,
            }
        ]

        return rrs
    }

    return calcOrig
})()


export default calcOrig
