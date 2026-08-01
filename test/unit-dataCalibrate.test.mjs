import assert from 'assert'
import dataCalibrate from '../src/dataCalibrate.mjs'


//規格來源: src/dataCalibrate.mjs 檔頭註解
//  dataCalibrate(calcFn, arrSrc, arrRef, pairs, optMethodInit, opt): 校正 optMethod, 使來源側各 keyOut 之
//  z-score 分布形狀對齊參考側對應 keyOut
//    形狀特徵 zshape = { 十分位 qs, |z|<0.1 之佔比 pNearZero }, 有限值不足 100 筆時為 null
//    距離 dist = 十分位平均絕對差 + pNearZero 差, 任一側形狀為 null 時為 Infinity
//    目標函數 score = 各 pair 之 dist 平均, 以 params 之值為鍵做快取
//    搜尋為逐維座標下降: 每維先粗掃 (現值 + 0 + ±mags), 再以粗掃最佳為中心做倍率細化與微調
//    防churn: 需 (score0-scoreBest)/score0 > threshold 且 (score0-scoreBest) > thresholdAbs 才採納
//    回傳 { adopt, optMethod, optMethodBest, score0, scoreBest, nEval, detail }
//      adopt=false 時 optMethod 維持 optMethodInit, optMethodBest 仍為搜尋所得最佳值


//測試用 K 線: 僅需 time 與供 calcFn 取用之欄位
let mkArr = (n) => {
    let arr = []
    for (let i = 0; i < n; i++) {
        arr.push({ time: `t${i}`, u: Math.sin(i * 1.7) })
    }
    return arr
}

//測試用 calcFn: X = u + a*u^2 (a 取自 optMethod.a, 預設 0), Y 與 X 同值供異名 pair 使用
//  二次項會改變分布之偏態, 故 z-score 形狀隨 a 變動
//  兩側取相同 a 時形狀完全一致 → dist 為 0, 此即目標函數之唯一最小值
let mkCalcFn = () => {
    let calls = []
    let calcFn = async (arr, keyIn, optMethod) => {
        calls.push({ n: arr.length, keyIn, optMethod: { ...optMethod } })
        let a = optMethod.a !== undefined ? optMethod.a : 0
        let vs = arr.map((v) => {
            let x = v.u + a * v.u * v.u
            return { time: v.time, X: x, Y: x }
        })
        return [{ period: 'p1', len: 1, vs }]
    }
    return { calcFn, calls }
}


describe('dataCalibrate', function() {

    it('回傳物件須含規格所列之各鍵', async function() {
        let arr = mkArr(400)
        let m = mkCalcFn()
        let r = await dataCalibrate(m.calcFn, arr, arr, ['X'], { a: 0 }, { optMethodRef: { a: 0.1 } })
        assert.deepStrictEqual(Object.keys(r).sort(), ['adopt', 'detail', 'nEval', 'optMethod', 'optMethodBest', 'score0', 'scoreBest'])
        assert.strictEqual(typeof r.adopt, 'boolean')
        assert.ok(Array.isArray(r.detail))
    })

    it('搜尋須收斂至使兩側形狀一致之參數 (參考側 a=0.1 → 最佳 a=0.1, 距離為 0)', async function() {
        //ref 側以 optMethodRef={a:0.1} 產生形狀, src 側取同值時兩序列完全相同 → 十分位與 pNearZero 皆相等 → dist=0
        //0.1 落在預設粗掃階梯 mags 內, 故粗掃即可命中, 後續細化因無法再降低而保持該值
        let arr = mkArr(400)
        let m = mkCalcFn()
        let r = await dataCalibrate(m.calcFn, arr, arr, ['X'], { a: 0 }, { optMethodRef: { a: 0.1 } })
        assert.strictEqual(r.optMethodBest.a, 0.1)
        assert.strictEqual(r.scoreBest, 0)
        assert.ok(r.score0 > 0, '起點 a=0 之距離須大於 0')
        assert.strictEqual(r.adopt, true, '相對與絕對改善皆達門檻須採納')
        assert.deepStrictEqual(r.optMethod, { a: 0.1 })
        assert.strictEqual(r.detail[0].dist, 0)
        assert.strictEqual(r.detail[0].pNearZeroSrc, r.detail[0].pNearZeroRef)
    })

    it('參考側須以 opt.optMethodRef 呼叫, keyIn 未指定時為 none', async function() {
        let arr = mkArr(400)
        let m = mkCalcFn()
        await dataCalibrate(m.calcFn, arr, arr, ['X'], { a: 0 }, { optMethodRef: { a: 0.1 } })
        assert.deepStrictEqual(m.calls[0].optMethod, { a: 0.1 }, '第一次呼叫為參考側')
        assert.strictEqual(m.calls[0].keyIn, 'none')
    })

    it('opt.keyIn 須原樣傳入 calcFn', async function() {
        let arr = mkArr(400)
        let m = mkCalcFn()
        await dataCalibrate(m.calcFn, arr, arr, ['X'], { a: 0 }, { keyIn: 'Close' })
        m.calls.forEach((v, i) => {
            assert.strictEqual(v.keyIn, 'Close', `第 ${i} 次呼叫`)
        })
    })

    it('目標函數具快取: calcFn 呼叫次數為 nEval 加 2 (參考側一次 + 最終 detail 一次)', async function() {
        //粗掃候選含重複值(現值與 0 或 ±mags 可能重合), 細化階段亦會重訪, 命中快取者不再呼叫 calcFn
        let arr = mkArr(400)
        let m = mkCalcFn()
        let r = await dataCalibrate(m.calcFn, arr, arr, ['X'], { a: 0 }, { optMethodRef: { a: 0.1 } })
        assert.strictEqual(m.calls.length, r.nEval + 2)
    })

    it('pairs 之字串縮寫須展開為兩側同名之 keyOut', async function() {
        let arr = mkArr(400)
        let m = mkCalcFn()
        let r = await dataCalibrate(m.calcFn, arr, arr, ['X'], { a: 0 }, { optMethodRef: { a: 0.1 } })
        assert.strictEqual(r.detail.length, 1)
        assert.strictEqual(r.detail[0].keyOutSrc, 'X')
        assert.strictEqual(r.detail[0].keyOutRef, 'X')
    })

    it('pairs 之物件形式可指定兩側不同名之 keyOut', async function() {
        //Y 與 X 同值, 故 keyOutSrc=Y 對 keyOutRef=X 之最佳解仍為 a=0.1
        let arr = mkArr(400)
        let m = mkCalcFn()
        let r = await dataCalibrate(m.calcFn, arr, arr, [{ keyOutSrc: 'Y', keyOutRef: 'X' }], { a: 0 }, { optMethodRef: { a: 0.1 } })
        assert.strictEqual(r.detail[0].keyOutSrc, 'Y')
        assert.strictEqual(r.detail[0].keyOutRef, 'X')
        assert.strictEqual(r.optMethodBest.a, 0.1)
        assert.strictEqual(r.scoreBest, 0)
    })

    it('防churn: 絕對改善未達 thresholdAbs 時不採納, optMethod 維持起始值', async function() {
        //起點 a=0.3 之距離約 0.087, 搜尋雖找到 a=0.1 使距離為 0, 但絕對改善 0.087 未達 thresholdAbs=1
        let arr = mkArr(400)
        let m = mkCalcFn()
        let r = await dataCalibrate(m.calcFn, arr, arr, ['X'], { a: 0.3 }, { optMethodRef: { a: 0.1 }, thresholdAbs: 1 })
        assert.strictEqual(r.adopt, false)
        assert.deepStrictEqual(r.optMethod, { a: 0.3 }, '不採納時須回傳起始值')
        assert.strictEqual(r.optMethodBest.a, 0.1, '不採納亦須回報搜尋所得最佳值')
        assert.ok(r.score0 - r.scoreBest > 0, '確有改善只是未達門檻')
    })

    it('防churn: 搜尋無改善時不採納', async function() {
        //對不影響 calcFn 之參數 c 搜尋, 各候選之距離皆與起點相同 → 改善為 0
        let arr = mkArr(400)
        let m = mkCalcFn()
        let r = await dataCalibrate(m.calcFn, arr, arr, ['X'], { a: 0.1 }, { params: ['c'], optMethodRef: { a: 0.1 } })
        assert.strictEqual(r.score0, r.scoreBest)
        assert.strictEqual(r.adopt, false)
        assert.deepStrictEqual(r.optMethod, { a: 0.1 })
    })

    it('params 指定 optMethodInit 內不存在之鍵時以 0 起算, 其餘鍵原樣保留', async function() {
        let arr = mkArr(400)
        let m = mkCalcFn()
        let r = await dataCalibrate(m.calcFn, arr, arr, ['X'], { b: 5 }, { params: ['a'], optMethodRef: { a: 0.1 } })
        assert.strictEqual(r.optMethodBest.b, 5, '未列入 params 之鍵須保留')
        assert.strictEqual(r.optMethodBest.a, 0.1)
        assert.strictEqual(m.calls[1].optMethod.a, 0, '搜尋起點須以 0 起算')
    })

    it('有限值不足 100 筆時形狀無法估計, 距離與分數為 Infinity 且不採納', async function() {
        //zshape 於 n<100 回傳 null, dist 對 null 給 Infinity
        let arr = mkArr(50)
        let m = mkCalcFn()
        let r = await dataCalibrate(m.calcFn, arr, arr, ['X'], { a: 0 }, { optMethodRef: { a: 0.1 } })
        assert.strictEqual(r.score0, Infinity)
        assert.strictEqual(r.scoreBest, Infinity)
        assert.strictEqual(r.adopt, false)
        assert.strictEqual(r.detail[0].dist, Infinity)
        assert.strictEqual(r.detail[0].pNearZeroSrc, null)
        assert.strictEqual(r.detail[0].pNearZeroRef, null)
    })

    it('calcFn 拋錯之候選其分數為 Infinity, 不影響整體流程', async function() {
        //僅在 a 為某特定值時拋錯, 該候選應被視為 Infinity 而不中斷搜尋
        let arr = mkArr(400)
        let calcFn = async (arr2, keyIn, optMethod) => {
            let a = optMethod.a !== undefined ? optMethod.a : 0
            if (a === 0.3) {
                throw new Error('boom')
            }
            let vs = arr2.map((v) => {
                let x = v.u + a * v.u * v.u
                return { time: v.time, X: x }
            })
            return [{ period: 'p1', len: 1, vs }]
        }
        let r = await dataCalibrate(calcFn, arr, arr, ['X'], { a: 0 }, { optMethodRef: { a: 0.1 } })
        assert.strictEqual(r.optMethodBest.a, 0.1)
        assert.strictEqual(r.scoreBest, 0)
    })

    it('opt.funLog 於每輪每個參數各回呼一次, 且多參數時預設掃 2 輪', async function() {
        //nSweep 預設: 單參數 1 輪, 多參數 2 輪
        let arr = mkArr(400)

        let logs1 = []
        let m1 = mkCalcFn()
        await dataCalibrate(m1.calcFn, arr, arr, ['X'], { a: 0 }, {
            optMethodRef: { a: 0.1 },
            funLog: (msg) => {
                logs1.push(msg)
            },
        })
        assert.strictEqual(logs1.length, 1, '單參數 1 輪 × 1 參數')
        assert.ok(logs1[0].indexOf('sweep1 a: 0.1') === 0, `訊息須含參數名與最終值: ${logs1[0]}`)

        let logs2 = []
        let m2 = mkCalcFn()
        await dataCalibrate(m2.calcFn, arr, arr, ['X'], { a: 0, c: 0 }, {
            optMethodRef: { a: 0.1 },
            funLog: (msg) => {
                logs2.push(msg)
            },
        })
        assert.strictEqual(logs2.length, 4, '多參數 2 輪 × 2 參數')
    })

    it('opt.mags 可自訂粗掃階梯', async function() {
        //階梯不含 0.1 且細化倍率無法由其他候選乘抵至 0.1 時, 最佳值不會是 0.1
        let arr = mkArr(400)
        let m = mkCalcFn()
        let r = await dataCalibrate(m.calcFn, arr, arr, ['X'], { a: 0 }, { optMethodRef: { a: 0.1 }, mags: [0.5] })
        assert.ok(r.scoreBest <= r.score0, '搜尋不得使分數變差')
        assert.ok(Number.isFinite(r.optMethodBest.a))
    })

    it('輸入檢核: 各必要參數不合法時須拋錯', async function() {
        let arr = mkArr(400)
        let m = mkCalcFn()
        await assert.rejects(dataCalibrate(null, arr, arr, ['X'], { a: 0 }), /invalid calcFn/)
        await assert.rejects(dataCalibrate(m.calcFn, null, arr, ['X'], { a: 0 }), /invalid arrSrc/)
        await assert.rejects(dataCalibrate(m.calcFn, arr, null, ['X'], { a: 0 }), /invalid arrRef/)
        await assert.rejects(dataCalibrate(m.calcFn, arr, arr, [], { a: 0 }), /invalid pairs/)
        await assert.rejects(dataCalibrate(m.calcFn, arr, arr, ['X'], {}), /invalid optMethodInit/)
    })

    it('輸入檢核: pair 與 opt 內容不合法時須拋錯', async function() {
        let arr = mkArr(400)
        let m = mkCalcFn()
        await assert.rejects(dataCalibrate(m.calcFn, arr, arr, [{ keyOutRef: 'X' }], { a: 0 }), /invalid pair.keyOutSrc/)
        await assert.rejects(dataCalibrate(m.calcFn, arr, arr, [{ keyOutSrc: 'X' }], { a: 0 }), /invalid pair.keyOutRef/)
        await assert.rejects(dataCalibrate(m.calcFn, arr, arr, ['X'], { a: 0 }, { params: [1] }), /invalid opt.params/)
        await assert.rejects(dataCalibrate(m.calcFn, arr, arr, ['X'], { a: 0 }, { keyIn: 5 }), /invalid opt.keyIn/)
    })

})
