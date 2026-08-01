import path from 'path'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import flatten from 'lodash-es/flatten.js'
import min from 'lodash-es/min.js'
import max from 'lodash-es/max.js'
import isestr from 'wsemi/src/isestr.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import ispm from 'wsemi/src/ispm.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import wsta from 'w-statistic'
import writeJson from './writeJson.mjs'


let dataConvert = async (name, symbol, interval, cointpe, keyKind, methods, arrOhlc, kp, fdSelfData, opt = {}) => {

    //check
    if (!isestr(name)) {
        throw new Error(`invalid name`)
    }
    if (!isestr(symbol)) {
        throw new Error(`invalid symbol`)
    }
    if (!isestr(interval)) {
        throw new Error(`invalid interval`)
    }
    if (!isestr(cointpe)) {
        throw new Error(`invalid cointpe`)
    }
    if (!isestr(keyKind)) {
        throw new Error(`invalid keyKind`)
    }
    if (!isearr(methods)) {
        throw new Error(`invalid methods`)
    }
    if (!isearr(arrOhlc)) {
        throw new Error(`invalid arrOhlc`)
    }
    if (!iseobj(kp)) {
        throw new Error(`invalid kp`)
    }
    if (!isestr(fdSelfData)) {
        throw new Error(`invalid fdSelfData`)
    }

    //opt
    let funAddKeysIn = get(opt, 'funAddKeysIn')
    let keysIn = get(opt, 'keysIn')
    let denyOutput = get(opt, 'denyOutput', null)

    //arr
    let arr = arrOhlc

    //funAddKeysIn
    if (isfun(funAddKeysIn)) {
        let ts = []
        await pmSeries(arr, async (v) => {
            let t = funAddKeysIn(v)
            if (ispm(t)) {
                t = await t
            }
            ts.push(t)
        })
        arr = ts
        // console.log('arr', arr)
    }

    //keysIn
    if (!isearr(keysIn)) {
        keysIn = ['none']
    }

    //nor: 正規化 rrs 各期之 keyOut 為 param 序列, 每期呼叫 funPeriod(可選, 不傳=純轉換不落地), 回傳攤平之全期 param
    let nor = (rrs, keyOut, _avg, _std, funPeriod) => {

        // //強制數據為未修正狀態
        // _avg = 0
        // _std = 1

        let pss = []
        each(rrs, (v) => {
            // console.log('v.vs', v.vs)

            //corr
            let vs = map(v.vs, (m) => {
                let param = (m[keyOut] - _avg) / _std
                let v = {
                    time: m.time,
                    param,
                }
                return v
            })

            //ps and push
            let ps = map(vs, 'param')
            pss.push(ps)

            //funPeriod
            if (isfun(funPeriod)) {
                funPeriod(v, vs, ps)
            }

        })

        //pss
        pss = flatten(pss)
        // console.log('pss', pss)

        return pss
    }

    //rs
    let rs = []
    await pmSeries(keysIn, async (keyIn) => {

        //check
        if (!isestr(keyIn)) {
            throw new Error(`invalid keyIn[${keyIn}]`)
        }

        await pmSeries(methods, async (m) => {

            //check
            if (!iseobj(m)) {
                console.log('methods', methods)
                console.log('m', m)
                throw new Error(`invalid m[${m}]`)
            }

            //method
            let method = get(m, 'method')

            //check
            if (!isestr(method)) {
                console.log('methods', methods)
                console.log('m', m)
                throw new Error(`invalid m.method[${method}]`)
            }

            //check
            if (!haskey(kp, method)) {
                console.log('kp', kp)
                console.log('methods', methods)
                console.log('m', m)
                throw new Error(`invalid m.method[${method}] in kp`)
            }

            //deals
            let deals = get(m, 'deals')

            //check
            if (!isearr(deals)) {
                console.log('methods', methods)
                console.log('m', m)
                throw new Error(`invalid m.deals[${deals}]`)
            }

            //optMethod: 由 opt 內 method 區塊指定 (例: opt_index_ohlc_klr 加 plusClose=0.5)
            //讓不同 cointpe + 指標可以有客製 opt (price 端可不傳, 維持 {} 預設)
            let optMethod = get(m, 'optMethod', {})

            //rrs
            let rrs = await kp[method](arr, keyIn, optMethod)
            // console.log('rrs', rrs)

            await pmSeries(deals, async(deal) => {

                //_keyIn
                let _keyIn = get(deal, 'keyIn')

                //check
                if (isestr(_keyIn)) { //若有指定keyIn才比對
                    if (keyIn !== _keyIn) {
                        return
                    }
                }

                //keyOut
                let keyOut = get(deal, 'keyOut')

                //check
                if (!isestr(keyOut)) {
                    console.log('deals', deals)
                    console.log('deal', deal)
                    throw new Error(`invalid deal.keyOut[${keyOut}]`)
                }

                //nm
                let nm = get(deal, 'nm')

                //check
                if (!iseobj(nm)) {
                    console.log('deals', deals)
                    console.log('deal', deal)
                    throw new Error(`invalid deal.nm[${nm}]`)
                }

                //corr
                let avg = get(nm, `avg`, 0)
                let std = get(nm, `std`, 1)

                //funOut
                let funOut = (v, vs, ps) => {

                    //fn
                    let fn = `${cointpe}_${keyKind}_${keyIn}_${keyOut}_${method}_${v.period}.json`

                    //fp
                    let fp = path.resolve(fdSelfData, fn)

                    //writeJson
                    //console.log(`writing...`, fn)
                    writeJson(fp, vs)

                }
                if (denyOutput === true) {
                    funOut = () => {}
                }

                //pss
                let pss = nor(rrs, keyOut, avg, std, funOut)

                //r
                let r = {}
                if (true) {

                    //avgAll, stdAll, minAll, maxAll
                    let avgAll = wsta.arrAverage(pss)
                    let stdAll = wsta.arrStd(pss)
                    let minAll = min(pss)
                    let maxAll = max(pss)
                    //console.log('keyIn', keyIn, 'method', method, 'keyOut', keyOut)
                    //console.log('avg:', avgAll, ',')
                    //console.log('std:', stdAll, ',')
                    //console.log('min:', minAll, ',')
                    //console.log('max:', maxAll, ',')
                    //console.log(' ')

                    //save
                    r = {
                        method,
                        keyIn,
                        keyOut,
                        avg: avgAll,
                        std: stdAll,
                        min: minAll,
                        max: maxAll,
                    }

                }

                //push
                rs.push(r)

            })

        })

    })

    return rs
}


export default dataConvert
