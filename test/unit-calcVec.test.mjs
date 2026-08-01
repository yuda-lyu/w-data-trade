import assert from 'assert'
import calcVec from '../src/calcVec.mjs'
import { genOhlc, genFlat, ohlcFromCloses, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll } from './unit-setup.mjs'


//規格來源: src/calcVec.mjs (與 src/pickValue.mjs)
//  pickValue(arr,key) 先轉為 { time, value } (time 需為字串, value 需為數字, 否則該筆被濾除); arr/key 不合法時 throw
//  vec(len) = value[i] - value[i-len]  (後-前之差值, 非真實速度)
//  ratioVec = value[i]!==0 ? vec/value[i] : 0  (對當下值正規化, 現值為 0 時特例回 0)
//  opt.norm=true 時 param=ratioVec, 否則 param=vec (預設)
//  n<len 時該期回傳 []
//  第一筆輸出對應輸入索引 = len (非 len-1, 因迴圈自 i=len 起算, 需 i-len>=0)
let kp = {
    '4hr': 1,
    '8hr': 2,
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

//參考實作: 直接依定義計算差值向量 (不 import src/calcVec.mjs 內部邏輯)
let refVec = (cs, len, norm) => {
    let rs = []
    for (let i = len; i < cs.length; i++) {
        let vec = cs[i] - cs[i - len]
        let ratioVec = cs[i] !== 0 ? vec / cs[i] : 0
        rs.push(norm ? ratioVec : vec)
    }
    return rs
}


describe('calcVec', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(200)
        let rrs = await calcVec(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len 根起算並逐根對齊 (非 len-1)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcVec(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len)
        })
    })

    it('param 預設須等於 value[i]-value[i-len]', async function() {
        let arr = genOhlc(200)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcVec(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertNearAll(r.vs, 'param', refVec(cs, len, false), 1e-9, period)
        })
    })

    it('手算例: 收盤 1..6, 4hr(len=1) 差值逐根皆為 1', async function() {
        let arr = ohlcFromCloses([1, 2, 3, 4, 5, 6])
        let rrs = await calcVec(arr, 'Close')
        let r = pickPeriod(rrs, '4hr')
        assert.strictEqual(r.vs.length, 5)
        r.vs.forEach((v, i) => {
            assertNear(v.param, 1, 1e-12, `第 ${i} 筆`)
            assert.strictEqual(v.time, arr[i + 1].time)
        })
        assert.strictEqual(pickPeriod(rrs, '8hr').vs.length, 4)
    })

    it('手算例: opt.norm=true 時 param=(value[i]-value[i-len])/value[i]', async function() {
        // cs=[1,2,3,4,5,6], len=2 (8hr): i=2:(3-1)/3=2/3; i=3:(4-2)/4=0.5; i=4:(5-3)/5=0.4; i=5:(6-4)/6=1/3
        let arr = ohlcFromCloses([1, 2, 3, 4, 5, 6])
        let rrs = await calcVec(arr, 'Close', { norm: true })
        let r = pickPeriod(rrs, '8hr')
        let exps = [2 / 3, 0.5, 0.4, 1 / 3]
        assertNearAll(r.vs, 'param', exps, 1e-12, '8hr norm')
    })

    it('現值為 0 時 ratioVec 特例回傳 0 (僅影響 norm 模式, 不影響原始 vec)', async function() {
        // cs=[5,0,2], 4hr(len=1): i=1(value=0): vec=0-5=-5, ratioVec 因 value[i]=0 => 0
        //                          i=2(value=2): vec=2-0=2, ratioVec=2/2=1
        let arr = ohlcFromCloses([5, 0, 2])
        let rrsNorm = await calcVec(arr, 'Close', { norm: true })
        let rNorm = pickPeriod(rrsNorm, '4hr')
        assertNear(rNorm.vs[0].param, 0, 1e-12, 'i=1 現值為0之 ratioVec 特例')
        assertNear(rNorm.vs[1].param, 1, 1e-12, 'i=2')

        let rrs = await calcVec(arr, 'Close')
        let r = pickPeriod(rrs, '4hr')
        assertNear(r.vs[0].param, -5, 1e-12, 'vec 本身不受現值為0影響')
    })

    it('定值序列之 vec 恆為 0', async function() {
        let arr = genFlat(30, 50)
        let rrs = await calcVec(arr, 'Close')
        pickPeriod(rrs, '1day').vs.forEach((v, i) => {
            assertNear(v.param, 0, 1e-12, `第 ${i} 筆定值`)
        })
    })

    it('資料筆數少於 len 時該期回傳空陣列 (以 n=3 檢驗 len>=3 之各期)', async function() {
        // pickValue 要求 arr 至少 1 筆 (isearr), 故不可用空陣列驗證此邊界, 改用短陣列
        let arr = genOhlc(3)
        let rrs = await calcVec(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            if (len >= 3) {
                let r = pickPeriod(rrs, period)
                assert.strictEqual(r.vs.length, 0, `${period} 應為空`)
            }
        })
    })

    it('可改用其他數值欄位計算 (key=Open)', async function() {
        let arr = genOhlc(50)
        let os = valuesOf(arr, 'Open')
        let rrs = await calcVec(arr, 'Open')
        assertNearAll(pickPeriod(rrs, '1day').vs, 'param', refVec(os, 6, false), 1e-9, 'Open')
    })

    it('arr 不合法時應 throw (經 pickValue 檢查)', async function() {
        await assert.rejects(calcVec(null, 'Close'), 'arr=null 應 throw')
        await assert.rejects(calcVec('not-an-array', 'Close'), 'arr=字串 應 throw')
    })

    it('key 不合法時應 throw (經 pickValue 檢查)', async function() {
        let arr = genOhlc(10)
        await assert.rejects(calcVec(arr, null), 'key=null 應 throw')
        await assert.rejects(calcVec(arr, 123), 'key=數字 應 throw')
    })

})
