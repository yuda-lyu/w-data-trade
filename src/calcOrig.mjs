import map from 'lodash-es/map.js'


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
