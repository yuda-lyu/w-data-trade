import assert from 'assert'
import pickValue from '../src/pickValue.mjs'
import { genOhlc, valuesOf } from './unit-setup.mjs'


//規格來源: src/pickValue.mjs
//  pickValue(arr, key): 將 arr 轉為 [{time, value}]
//  arr 需為 wsemi isearr 判定之有效陣列 (非陣列, 或陣列長度為 0 皆視為無效) => 否則 throw
//  key 需為 wsemi isestr 判定之非空字串 => 否則 throw
//  逐筆取 v.time 與 v[key]:
//    time 非 string 之列剔除
//    value (v[key]) 非 wsemi isnum 判定之數值者剔除
//      isnum 接受數值與可解析之數字字串 (含前後空白 / 科學記號 / 16 進位), 但不接受 NaN / 布林 / 空字串 / null
//    通過者再經 wsemi cdbl 轉為 number 型別 (故數字字串會被轉成數值; Infinity 會被 cdbl 轉為 Number.MAX_VALUE)
//    轉型後量級防呆: |value| > 1e15 時 throw (±Infinity 因 cdbl 轉為 ±Number.MAX_VALUE 而在此被擋下)
//  最終再以 lodash isNumber(value) 過濾一次 (與前段邏輯等價之保險)


describe('pickValue', function() {

    it('基本轉換: 逐筆取出 {time, value}', function() {
        let arr = [
            { time: 't1', Close: 10 },
            { time: 't2', Close: 20 },
        ]
        let r = pickValue(arr, 'Close')
        assert.deepStrictEqual(r, [
            { time: 't1', value: 10 },
            { time: 't2', value: 20 },
        ])
    })

    it('time 非字串之列被剔除', function() {
        let arr = [
            { time: 123, Close: 10 }, //time 非字串 => 剔除
            { time: 't2', Close: 20 },
        ]
        let r = pickValue(arr, 'Close')
        assert.deepStrictEqual(r, [
            { time: 't2', value: 20 },
        ])
    })

    it('time 為空字串仍是有效字串, 不因空字串被剔除', function() {
        let arr = [
            { time: '', Close: 10 },
        ]
        let r = pickValue(arr, 'Close')
        assert.deepStrictEqual(r, [
            { time: '', value: 10 },
        ])
    })

    it('value 非數值之列被剔除', function() {
        let arr = [
            { time: 't1', Close: 'abc' }, //字串, 非數值 => 剔除
            { time: 't2', Close: 20 },
        ]
        let r = pickValue(arr, 'Close')
        assert.deepStrictEqual(r, [
            { time: 't2', value: 20 },
        ])
    })

    it('指定欄位缺失時取得預設空字串, 判非數值而剔除', function() {
        let arr = [
            { time: 't1' }, //無 Close 欄位
            { time: 't2', Close: 20 },
        ]
        let r = pickValue(arr, 'Close')
        assert.deepStrictEqual(r, [
            { time: 't2', value: 20 },
        ])
    })

    it('value 為 NaN 之列被剔除 (wsemi isnum 不接受 NaN)', function() {
        let arr = [
            { time: 't1', Close: NaN },
            { time: 't2', Close: 20 },
        ]
        let r = pickValue(arr, 'Close')
        assert.deepStrictEqual(r, [
            { time: 't2', value: 20 },
        ])
    })

    it('value 為可解析之數字字串時被接受, 並經 cdbl 轉為 number', function() {
        //isnum 接受數字字串, cdbl 轉型: '12.5'→12.5, 前後空白可容忍, '1e3'→1000, '0x10'→16
        let arr = [
            { time: 't1', Close: '12.5' },
            { time: 't2', Close: ' 12.5 ' },
            { time: 't3', Close: '1e3' },
            { time: 't4', Close: '0x10' },
        ]
        let r = pickValue(arr, 'Close')
        assert.deepStrictEqual(r, [
            { time: 't1', value: 12.5 },
            { time: 't2', value: 12.5 },
            { time: 't3', value: 1000 },
            { time: 't4', value: 16 },
        ])
    })

    it('布林 / 空字串 / null 之列被剔除 (皆非 isnum 認可之數值)', function() {
        let arr = [
            { time: 't1', Close: true },
            { time: 't2', Close: '' },
            { time: 't3', Close: null },
            { time: 't4', Close: 20 },
        ]
        let r = pickValue(arr, 'Close')
        assert.deepStrictEqual(r, [
            { time: 't4', value: 20 },
        ])
    })

    it('輸出之 value 恆為 number 型別且為有限數', function() {
        //isnum 濾掉 NaN, 數字字串經 cdbl 轉為 number, 逾量級者拋錯, 故輸出恆為有限數
        let arr = [
            { time: 't1', Close: 10 },
            { time: 't2', Close: '20' },
            { time: 't3', Close: NaN },
            { time: 't4', Close: -3.5 },
        ]
        let r = pickValue(arr, 'Close')
        assert.deepStrictEqual(r.map((v) => {
            return v.time
        }), ['t1', 't2', 't4'])
        r.forEach((v, i) => {
            assert.strictEqual(typeof v.value, 'number', `第 ${i} 筆型別`)
            assert.ok(Number.isFinite(v.value), `第 ${i} 筆須為有限數: ${v.value}`)
        })
    })

    it('絕對值超過 1e15 之值須拋錯 (量級防呆)', function() {
        //正負兩側各驗一次
        assert.throws(() => {
            pickValue([{ time: 't1', Close: 1e16 }], 'Close')
        }, /invalid value/)
        assert.throws(() => {
            pickValue([{ time: 't1', Close: -1e16 }], 'Close')
        }, /invalid value/)

        //數字字串亦於 cdbl 轉型後受檢
        assert.throws(() => {
            pickValue([{ time: 't1', Close: '1e16' }], 'Close')
        }, /invalid value/)
    })

    it('±Infinity 經 cdbl 轉為 ±Number.MAX_VALUE 後超過量級上限, 故拋錯', function() {
        //isnum(Infinity)===true 故不在剔除階段被濾掉, 而是在量級檢查被擋下
        assert.throws(() => {
            pickValue([{ time: 't1', Close: Infinity }], 'Close')
        }, /invalid value/)
        assert.throws(() => {
            pickValue([{ time: 't1', Close: -Infinity }], 'Close')
        }, /invalid value/)
    })

    it('絕對值恰為 1e15 之值不拋錯 (邊界不含)', function() {
        //原始碼判準為 > 1e15, 故 1e15 本身通過
        let r = pickValue([{ time: 't1', Close: 1e15 }, { time: 't2', Close: -1e15 }], 'Close')
        assert.deepStrictEqual(r, [
            { time: 't1', value: 1e15 },
            { time: 't2', value: -1e15 },
        ])
    })

    it('arr 非陣列時 throw', function() {
        assert.throws(() => {
            pickValue('not-an-array', 'Close')
        }, /invalid arr/)
        assert.throws(() => {
            pickValue(undefined, 'Close')
        }, /invalid arr/)
    })

    it('arr 為空陣列時 throw (wsemi isearr 判定空陣列為無效)', function() {
        assert.throws(() => {
            pickValue([], 'Close')
        }, /invalid arr/)
    })

    it('key 非字串時 throw', function() {
        assert.throws(() => {
            pickValue([{ time: 't1', Close: 10 }], 123)
        }, /invalid key/)
    })

    it('key 為空字串時 throw (wsemi isestr 判定空字串為無效)', function() {
        assert.throws(() => {
            pickValue([{ time: 't1', Close: 10 }], '')
        }, /invalid key/)
    })

    it('搭配合成 K 線資料: 轉換筆數與數值皆與來源逐筆對應', function() {
        let arr = genOhlc(80)
        let cs = valuesOf(arr, 'Close')
        let ts = valuesOf(arr, 'time')
        let r = pickValue(arr, 'Close')
        assert.strictEqual(r.length, arr.length)
        r.forEach((v, i) => {
            assert.strictEqual(v.time, ts[i])
            assert.strictEqual(v.value, cs[i])
        })
    })

    it('可改用其他數值欄位 (key=Volumn)', function() {
        let arr = genOhlc(30)
        let vols = valuesOf(arr, 'Volumn')
        let r = pickValue(arr, 'Volumn')
        r.forEach((v, i) => {
            assert.strictEqual(v.value, vols[i])
        })
    })

})
