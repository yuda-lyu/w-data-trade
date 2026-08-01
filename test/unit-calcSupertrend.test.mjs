import assert from 'assert'
import calcSupertrend from '../src/calcSupertrend.mjs'
import { genOhlc, genFlat, genUp, genDown, ohlcFromCloses, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll } from './unit-setup.mjs'


//規格來源: src/calcSupertrend.mjs (+ src/diviProt.mjs)
//  Supertrend (Olivier Seban) 之 ATR 通道與翻轉規則:
//    TR[i]         = max(|H-L|, |H-C[i-1]|, |L-C[i-1]|)
//    ATR 種子      = TR[1..len] 之 SMA (對應輸出第一根 i=len)
//    ATR[i]        = (ATR[i-1]*(len-1) + TR[i]) / len   (Wilder 平滑, i>len)
//    basicUpper    = (H+L)/2 + mult*ATR
//    basicLower    = (H+L)/2 - mult*ATR
//    finalUpper[i] = (basicUpper < finalUpper[i-1] 或 C[i-1] > finalUpper[i-1]) ? basicUpper : finalUpper[i-1]  (只能下移或被突破時重置)
//    finalLower[i] = (basicLower > finalLower[i-1] 或 C[i-1] < finalLower[i-1]) ? basicLower : finalLower[i-1]  (只能上移或被跌破時重置)
//    dir[i]        = 沿續 dir[i-1]; 多頭且 C < finalLower 轉空(-1), 空頭且 C > finalUpper 轉多(+1)
//    dir 起始根    = C <= finalUpper 視為空頭(-1), 否則多頭(+1)   [src:143-146]
//    line          = dir===1 ? finalLower : finalUpper
//  keyOut:
//    stDistance    = C!==0 ? (C - line)/C : 0                      [src:162]
//    stDistanceMod = diviProt(C+plusClose - line, C+plusClose)     [src:168-169]
//      opt.plusClose 預設 0, 此時 stDistanceMod 退化為原版 (C-line)/C
//      diviProt: |分母| < 0.00001 時 clamp 至 ±0.00001 (保留 sign)
//  第一筆輸出對應輸入索引 len; n < len+1 時該期回傳 []
let kp = {
    '12hr': { len: 3, mult: 2 },
    '16hr': { len: 4, mult: 2 },
    '20hr': { len: 5, mult: 2.5 },
    '1day': { len: 6, mult: 3 },
    '2day': { len: 12, mult: 3 },
    '4day': { len: 24, mult: 4 },
    '7day': { len: 42, mult: 4 },
    '15day': { len: 90, mult: 5 },
    '30day': { len: 180, mult: 5 },
}

//kp 之 period → len (assertRrsShape 用)
let kpLen = {}
Object.entries(kp).forEach(([period, cfg]) => {
    kpLen[period] = cfg.len
})

//參考實作: 依上列公式逐段暴力重算 (先備妥 TR 與 ATR 全序列, 再逐根推通道與方向)
let refSupertrend = (arr, len, mult) => {
    let n = arr.length
    if (n < len + 1) {
        return []
    }

    //TR 全序列
    let trs = [0]
    for (let i = 1; i < n; i++) {
        let h = arr[i].High
        let l = arr[i].Low
        let cPrev = arr[i - 1].Close
        trs.push(Math.max(Math.abs(h - l), Math.abs(h - cPrev), Math.abs(l - cPrev)))
    }

    //ATR 全序列 (i<len 不需要)
    let atrs = new Array(n).fill(null)
    let seed = 0
    for (let i = 1; i <= len; i++) {
        seed += trs[i]
    }
    atrs[len] = seed / len
    for (let i = len + 1; i < n; i++) {
        atrs[i] = (atrs[i - 1] * (len - 1) + trs[i]) / len
    }

    //逐根推通道與方向
    let rs = []
    let fuPrev = null
    let flPrev = null
    let dirPrev = null
    for (let i = len; i < n; i++) {
        let h = arr[i].High
        let l = arr[i].Low
        let c = arr[i].Close
        let cPrev = arr[i - 1].Close
        let bu = (h + l) / 2 + mult * atrs[i]
        let bl = (h + l) / 2 - mult * atrs[i]
        let fu = bu
        let fl = bl
        if (fuPrev !== null && bu >= fuPrev && cPrev <= fuPrev) {
            fu = fuPrev
        }
        if (flPrev !== null && bl <= flPrev && cPrev >= flPrev) {
            fl = flPrev
        }
        let dir = 1
        if (dirPrev === null) {
            dir = c <= fu ? -1 : 1
        }
        else if (dirPrev === 1) {
            dir = c < fl ? -1 : 1
        }
        else {
            dir = c > fu ? 1 : -1
        }
        let line = dir === 1 ? fl : fu
        rs.push({
            time: arr[i].time,
            dir,
            line,
            stDistance: c !== 0 ? (c - line) / c : 0,
        })
        fuPrev = fu
        flPrev = fl
        dirPrev = dir
    }
    return rs
}

//參考實作: diviProt 之 clamp 規則 (|d| < 0.00001 時 clamp 至 ±0.00001, d===0 視為正)
let refDivi = (u, d) => {
    let dd = d
    if (Math.abs(dd) < 0.00001) {
        dd = dd < 0 ? -0.00001 : 0.00001
    }
    return u / dd
}


describe('calcSupertrend', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(400)
        let rrs = await calcSupertrend(arr, 'Close')
        assertRrsShape(rrs, kpLen)
    })

    it('各期時間軸自第 len 根起算並逐根對齊 (ATR 種子吃掉前 len 根)', async function() {
        let arr = genOhlc(400)
        let rrs = await calcSupertrend(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, cfg.len)
        })
    })

    it('stDistance 須等於參考實作之 (Close - ST線)/Close', async function() {
        let arr = genOhlc(400)
        let rrs = await calcSupertrend(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            let exps = refSupertrend(arr, cfg.len, cfg.mult).map((v) => {
                return v.stDistance
            })
            assertNearAll(r.vs, 'stDistance', exps, 1e-9, period)
        })
    })

    it('plusClose 預設 0 時 stDistanceMod 退化為原版 stDistance', async function() {
        //src:165 註記 plusClose=0 時退化成原版 (c-line)/c, 且此資料 Close 皆遠離 0 不觸發 clamp
        let arr = genOhlc(400)
        let rrs = await calcSupertrend(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, i) => {
                assertNear(v.stDistanceMod, v.stDistance, 1e-12, `${r.period} 第 ${i} 筆`)
            })
        })
    })

    it('手算例: 4 根 K 線於 len=3, mult=2 之 stDistance = -7/39', async function() {
        //收盤 [10,12,11,13] 且無影線, 故 O/H/L/C 為
        //  i=0: O=10 H=10 L=10 C=10
        //  i=1: O=10 H=12 L=10 C=12
        //  i=2: O=12 H=12 L=11 C=11
        //  i=3: O=11 H=13 L=11 C=13
        //手算:
        //  TR[1]=max(|12-10|,|12-10|,|10-10|)=2, TR[2]=max(1,0,1)=1, TR[3]=max(|13-11|,|13-11|,|11-11|)=2
        //  ATR 種子 = (2+1+2)/3 = 5/3
        //  i=3: hl2=(13+11)/2=12, basicUpper=12+2*5/3=46/3, basicLower=12-10/3=26/3
        //       首根無前值 → finalUpper=46/3, finalLower=26/3
        //       C=13 <= finalUpper=15.3333 → dir=-1 (空頭起點), line=finalUpper=46/3
        //       stDistance=(13-46/3)/13 = (-7/3)/13 = -7/39
        let arr = ohlcFromCloses([10, 12, 11, 13], { wick: 0 })
        let rrs = await calcSupertrend(arr, 'Close')
        let r = pickPeriod(rrs, '12hr')
        assert.strictEqual(r.vs.length, 1)
        assert.strictEqual(r.vs[0].time, arr[3].time)
        assertNear(r.vs[0].stDistance, -7 / 39, 1e-12, '12hr stDistance')
        assertNear(r.vs[0].stDistanceMod, -7 / 39, 1e-12, '12hr stDistanceMod')
        //len=4 之 16hr 需 n>=5, 故無輸出
        assert.strictEqual(pickPeriod(rrs, '16hr').vs.length, 0)
    })

    it('手算例: 收盤跳漲突破 finalUpper 時翻多, line 改用鎖死之 finalLower', async function() {
        //收盤 [10,12,11,13,30] 且無影線, 前 4 根同上例, 第 5 根 O=13 H=30 L=13 C=30
        //手算:
        //  i=3: 同上例, dir=-1, finalUpper=46/3, finalLower=26/3, ATR=5/3
        //  i=4: TR[4]=max(|30-13|,|30-13|,|13-13|)=17, ATR=(5/3*2+17)/3=61/9
        //       hl2=(30+13)/2=21.5, basicUpper=21.5+2*61/9=35.0555…, basicLower=21.5-122/9=7.9444…
        //       finalUpper: basicUpper 未小於前值(46/3) 且前根 C=13 未突破前值 → 鎖死 46/3
        //       finalLower: basicLower 未大於前值(26/3) 且前根 C=13 未跌破前值 → 鎖死 26/3
        //       dir: 前根空頭且 C=30 > finalUpper=46/3 → 翻多 dir=1, line=finalLower=26/3
        //       stDistance=(30-26/3)/30 = (64/3)/30 = 32/45
        let arr = ohlcFromCloses([10, 12, 11, 13, 30], { wick: 0 })
        let rrs = await calcSupertrend(arr, 'Close')
        let r = pickPeriod(rrs, '12hr')
        assert.strictEqual(r.vs.length, 2)
        assertNear(r.vs[0].stDistance, -7 / 39, 1e-12, '第 1 筆 (空頭)')
        assertNear(r.vs[1].stDistance, 32 / 45, 1e-12, '第 2 筆 (翻多)')
        assert.ok(r.vs[0].stDistance < 0, '空頭時 Close 須低於 ST 線')
        assert.ok(r.vs[1].stDistance > 0, '多頭時 Close 須高於 ST 線')
    })

    it('手算例: Close=0 時 stDistance 走 0 保護, stDistanceMod 走 diviProt clamp', async function() {
        //收盤 [10,12,11,0] 且無影線, 故 i=3: O=11 H=11 L=0 C=0
        //手算:
        //  TR[1]=2, TR[2]=1, TR[3]=max(|11-0|,|11-11|,|0-11|)=11, ATR 種子=(2+1+11)/3=14/3
        //  i=3: hl2=(11+0)/2=5.5, basicUpper=5.5+2*14/3=89/6, dir=-1 (C=0 <= 89/6), line=89/6
        //  stDistance: C===0 → 直接給 0
        //  stDistanceMod = diviProt(0-89/6, 0) → 分母 clamp 為 +0.00001 → -(89/6)/0.00001
        let arr = ohlcFromCloses([10, 12, 11, 0], { wick: 0 })
        let rrs = await calcSupertrend(arr, 'Close')
        let r = pickPeriod(rrs, '12hr')
        assert.strictEqual(r.vs.length, 1)
        assert.strictEqual(r.vs[0].stDistance, 0)
        assertNear(r.vs[0].stDistanceMod, -(89 / 6) / 0.00001, 1e-12, 'clamp 後之 stDistanceMod')
    })

    it('opt.plusClose 須把分子分母同時偏移為 (C+plusClose-line)/(C+plusClose)', async function() {
        //承上上例 (line=46/3, C=13): plusClose=2 → (15-46/3)/15 = (-1/3)/15 = -1/45
        let arr = ohlcFromCloses([10, 12, 11, 13], { wick: 0 })
        let rrs = await calcSupertrend(arr, 'Close', { plusClose: 2 })
        let r = pickPeriod(rrs, '12hr')
        assertNear(r.vs[0].stDistanceMod, -1 / 45, 1e-12, 'plusClose=2 之 stDistanceMod')
        //stDistance 為原版, 不受 plusClose 影響
        assertNear(r.vs[0].stDistance, -7 / 39, 1e-12, 'stDistance 不受 plusClose 影響')
    })

    it('opt.plusClose 可讓 Close=0 之 stDistanceMod 不再爆炸', async function() {
        //承 Close=0 例 (line=89/6): plusClose=2 → cp=2, (2-89/6)/2 = (-77/6)/2 = -77/12
        let arr = ohlcFromCloses([10, 12, 11, 0], { wick: 0 })
        let rrs = await calcSupertrend(arr, 'Close', { plusClose: 2 })
        let r = pickPeriod(rrs, '12hr')
        assertNear(r.vs[0].stDistanceMod, -77 / 12, 1e-12, 'plusClose=2 之 stDistanceMod')
    })

    it('opt.plusClose 於一般序列須等於 (C+p-line)/(C+p)', async function() {
        let arr = genOhlc(200)
        let cs = valuesOf(arr, 'Close')
        let p = 50
        let rrs = await calcSupertrend(arr, 'Close', { plusClose: p })
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            let exps = refSupertrend(arr, cfg.len, cfg.mult).map((v, i) => {
                let cp = cs[cfg.len + i] + p
                return refDivi(cp - v.line, cp)
            })
            assertNearAll(r.vs, 'stDistanceMod', exps, 1e-9, `${period} plusClose`)
        })
    })

    it('定值序列無波動 (ATR=0), ST 線恆等於價格, stDistance 恆為 0', async function() {
        //O=H=L=C=100 → TR 恆 0 → ATR=0 → basicUpper=basicLower=hl2=100=line
        //dir 起始為 -1 (C<=finalUpper) 且永不翻轉, stDistance=(100-100)/100=0
        let arr = genFlat(200)
        let rrs = await calcSupertrend(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, i) => {
                assert.strictEqual(v.stDistance, 0, `${r.period} 第 ${i} 筆 stDistance`)
                assert.strictEqual(v.stDistanceMod, 0, `${r.period} 第 ${i} 筆 stDistanceMod`)
            })
        })
    })

    it('單調上升序列: 翻多後 ST 線貼在 C-(mult+0.5), stDistance = (mult+0.5)/C', async function() {
        //genUp step=1 無影線: i>=1 時 H=C[i], L=C[i-1], 故 TR 恆為 1 → ATR 恆為 1
        //  hl2 = C[i]-0.5, basicUpper = C[i]-0.5+mult, basicLower = C[i]-0.5-mult
        //  首根 (j=0) 依起始規則為空頭, finalUpper 鎖死於 C[len]-0.5+mult
        //  之後 C 每根 +1, 直到 C 超過該鎖死值 (即 j > mult-0.5, 令 kFlip=floor(mult-0.5)+1) 才翻多
        //  j <  kFlip: line = C[len]-0.5+mult (鎖死), stDistance = (C[i]-line)/C[i] <= 0
        //  j >= kFlip: line = basicLower = C[i]-0.5-mult (逐根上移), stDistance = (mult+0.5)/C[i] > 0
        let arr = genUp(220)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcSupertrend(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let len = cfg.len
            let mult = cfg.mult
            let kFlip = Math.floor(mult - 0.5) + 1
            let lineLock = cs[len] - 0.5 + mult
            let r = pickPeriod(rrs, period)
            assert.ok(r.vs.length > kFlip, `${period} 樣本數須足以涵蓋翻多`)
            r.vs.forEach((v, j) => {
                let c = cs[len + j]
                if (j < kFlip) {
                    assertNear(v.stDistance, (c - lineLock) / c, 1e-9, `${period} 第 ${j} 筆 (未翻多)`)
                    assert.ok(v.stDistance <= 0, `${period} 第 ${j} 筆 未翻多時 stDistance 須不為正`)
                }
                else {
                    assertNear(v.stDistance, (mult + 0.5) / c, 1e-9, `${period} 第 ${j} 筆 (已翻多)`)
                    assert.ok(v.stDistance > 0, `${period} 第 ${j} 筆 多方時 stDistance 須為正`)
                }
            })
        })
    })

    it('單調下降序列: 恆為空方, stDistance = -(mult+0.5)/C', async function() {
        //genDown step=1 無影線: i>=1 時 H=C[i-1], L=C[i], 故 TR 恆為 1 → ATR 恆為 1
        //  hl2 = C[i]+0.5, basicUpper = C[i]+0.5+mult 逐根下移 → finalUpper 每根重置為 basicUpper
        //  C 恆不高於 finalUpper → dir 恆為 -1, line = C[i]+0.5+mult
        //  stDistance = (C[i]-line)/C[i] = -(mult+0.5)/C[i]
        let arr = genDown(220)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcSupertrend(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            r.vs.forEach((v, j) => {
                let c = cs[cfg.len + j]
                assertNear(v.stDistance, -(cfg.mult + 0.5) / c, 1e-9, `${period} 第 ${j} 筆`)
                assert.ok(v.stDistance < 0, `${period} 第 ${j} 筆 空方時 stDistance 須為負`)
            })
        })
    })

    it('方向沿續期間 ST 線只朝有利方向移動 (移動停損不回頭)', async function() {
        //Supertrend 定義: 多頭時 line 只升不降, 空頭時 line 只降不升, 直到翻轉才跳到對側
        //輸出未直接給 line, 由 line = C*(1-stDistance) 還原; Close 皆為正, 故 stDistance 之正負即方向
        let arr = genOhlc(400)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcSupertrend(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            let linePrev = null
            let sgnPrev = 0
            r.vs.forEach((v, j) => {
                let c = cs[cfg.len + j]
                let line = c * (1 - v.stDistance)
                let sgn = v.stDistance >= 0 ? 1 : -1
                if (linePrev !== null && sgn === sgnPrev) {
                    if (sgn === 1) {
                        assert.ok(line >= linePrev - 1e-9, `${period} 第 ${j} 筆 多方 ST 線下降: ${linePrev} → ${line}`)
                    }
                    else {
                        assert.ok(line <= linePrev + 1e-9, `${period} 第 ${j} 筆 空方 ST 線上升: ${linePrev} → ${line}`)
                    }
                }
                linePrev = line
                sgnPrev = sgn
            })
        })
    })

    it('ST 線與 Close 之相對位置須與方向一致 (多頭在下, 空頭在上)', async function() {
        //由 stDistance 之正負即可判別: 多頭 line=finalLower<=C → 非負, 空頭 line=finalUpper>=C → 非正
        //故 stDistance 不得同時出現「與參考實作方向不符」之情形
        let arr = genOhlc(400)
        let rrs = await calcSupertrend(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            let refs = refSupertrend(arr, cfg.len, cfg.mult)
            r.vs.forEach((v, j) => {
                let dir = refs[j].dir
                assert.ok(dir === 1 || dir === -1, `${period} 第 ${j} 筆 方向須為 ±1`)
                if (dir === 1) {
                    assert.ok(v.stDistance >= 0, `${period} 第 ${j} 筆 多頭但 stDistance 為負: ${v.stDistance}`)
                }
                else {
                    assert.ok(v.stDistance <= 0, `${period} 第 ${j} 筆 空頭但 stDistance 為正: ${v.stDistance}`)
                }
            })
        })
    })

    it('資料筆數不足 len+1 時該期回傳空陣列', async function() {
        //n=3 未達最短期 12hr 之 len+1=4
        let arr = genOhlc(3)
        let rrs = await calcSupertrend(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('High 非數值時須拋錯 (src 之輸入檢查)', async function() {
        let arr = genOhlc(20)
        arr[1].High = null
        await assert.rejects(calcSupertrend(arr, 'Close'), /invalid h/)
    })

    it('Low 非數值時須拋錯 (src 之輸入檢查)', async function() {
        let arr = genOhlc(20)
        arr[1].Low = null
        await assert.rejects(calcSupertrend(arr, 'Close'), /invalid l/)
    })

    it('前一根 Close 非數值時須拋錯 (src 之輸入檢查)', async function() {
        let arr = genOhlc(20)
        arr[0].Close = null
        await assert.rejects(calcSupertrend(arr, 'Close'), /invalid cPrev/)
    })

})
