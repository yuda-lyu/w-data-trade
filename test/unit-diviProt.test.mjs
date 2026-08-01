import assert from 'assert'
import diviProt from '../src/diviProt.mjs'
import { assertNear } from './unit-setup.mjs'


//規格來源: src/diviProt.mjs
//  diviProt(u, d, opt): 除法保護
//  opt.plusDenominator (預設 0): 非 0 時先把分母推離 0 (d>=0 則 d+plusDenominator, d<0 則 d-plusDenominator)
//  之後若 |d| < 0.00001, clamp 至 ±0.00001 (依 d<0 判斷保留正負號, d===0 視為正)
//  回傳 u / d (以處理過之 d 計算)


describe('diviProt', function() {

    it('分母絕對值夠大時單純回傳 u/d', function() {
        assert.strictEqual(diviProt(10, 2), 5)
        assert.strictEqual(diviProt(6, 3), 2)
        assert.strictEqual(diviProt(-6, 3), -2)
        assert.strictEqual(diviProt(6, -3), -2)
    })

    it('d=0 且無 plusDenominator 時 clamp 至 +0.00001', function() {
        //手算: d=0, |0|<0.00001, d<0 為 false => d=0.00001, 1/0.00001≈100000
        let r = diviProt(1, 0)
        assertNear(r, 1 / 0.00001, 1e-9)
    })

    it('d 為微小正值時 clamp 至 +0.00001', function() {
        //手算: d=0.000005, |d|<0.00001, d<0 為 false => d=0.00001
        let r = diviProt(1, 0.000005)
        assertNear(r, 1 / 0.00001, 1e-9)
    })

    it('d 為微小負值時 clamp 至 -0.00001 並保留負號', function() {
        //手算: d=-0.000005, |d|<0.00001, d<0 為 true => d=-0.00001, 1/-0.00001≈-100000
        let r = diviProt(1, -0.000005)
        assertNear(r, 1 / -0.00001, 1e-9)
    })

    it('|d| 恰等於 clamp 邊界 0.00001 時不觸發 clamp (邊界不含)', function() {
        //手算: |d|=0.00001 不小於 0.00001, 不 clamp, 直接 1/0.00001 (與 clamp 後同值, 但走的是原生除法路徑)
        let r = diviProt(1, 0.00001)
        assertNear(r, 1 / 0.00001, 1e-9)
    })

    it('opt.plusDenominator 對正分母之效果為 d+plusDenominator', function() {
        //手算: d=5, plusDenominator=1 => d=6, 5/6
        let r = diviProt(5, 5, { plusDenominator: 1 })
        assert.strictEqual(r, 5 / 6)
    })

    it('opt.plusDenominator 對負分母之效果為 d-plusDenominator', function() {
        //手算: d=-2, plusDenominator=1 => d=-3, 5/-3
        let r = diviProt(5, -2, { plusDenominator: 1 })
        assert.strictEqual(r, 5 / -3)
    })

    it('opt.plusDenominator 對 d=0 視為正方向推離', function() {
        //手算: d=0 (>=0), plusDenominator=1 => d=1, 5/1=5, 且不再需要 clamp
        let r = diviProt(5, 0, { plusDenominator: 1 })
        assert.strictEqual(r, 5)
    })

    it('opt.plusDenominator 過小時仍可能落入 clamp 保護 (兩段保護皆生效)', function() {
        //手算: d=0 (>=0), plusDenominator=0.000001 => d=0.000001, |d|<0.00001 => 再 clamp 為 +0.00001
        let r = diviProt(1, 0, { plusDenominator: 0.000001 })
        assertNear(r, 1 / 0.00001, 1e-9)
    })

    it('opt.plusDenominator 過小且原分母為負時, clamp 後仍保留負號', function() {
        //手算: d=-0.000001 (<0), plusDenominator=0.000001 => d=-0.000002, |d|<0.00001 => clamp 為 -0.00001
        let r = diviProt(1, -0.000001, { plusDenominator: 0.000001 })
        assertNear(r, 1 / -0.00001, 1e-9)
    })

    it('plusDenominator=0 (顯式傳入) 等同不啟用推離, 僅走 clamp 保護', function() {
        let r1 = diviProt(1, 0, { plusDenominator: 0 })
        let r2 = diviProt(1, 0)
        assert.strictEqual(r1, r2)
    })

    it('u=0 時無論分母為何皆回傳 0 (只要分母非被 clamp 之極端狀況外皆成立)', function() {
        assert.strictEqual(diviProt(0, 10), 0)
        assert.strictEqual(diviProt(0, 0), 0) //0 / 0.00001 = 0
    })

})
