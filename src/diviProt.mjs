import isenum from 'wsemi/src/isenum.mjs'
import getOptReader from 'wsemi/src/getOptReader.mjs'


let diviProt = (u, d, opt) => {

    //plusDenominator, 經getOptReader讀取(給了即檢測, 非預期之輸入視為未給而改用預設0, opt.debug為true時警告); 檢測通過之數字字串轉為數值後使用
    //  未給opt時(各calc於逐根迴圈內之呼叫)不建立讀取函數, 維持熱路徑之成本
    let plusDenominator = 0
    if (opt !== undefined) {
        let rd = getOptReader('w-data-trade diviProt', opt)
        plusDenominator = Number(rd('plusDenominator', 0, (v) => isenum(v), 'a valid number', '0'))
    }

    //先 push 分母離開 0 (對 d=0 預設用正方向)
    if (plusDenominator !== 0) {
        if (d >= 0) {
            d = d + plusDenominator
        }
        else {
            d = d - plusDenominator
        }
    }

    //floor 保護: |d| < 0.00001 時 clamp 至 ±0.00001 (保留 sign)
    if (Math.abs(d) < 0.00001) {
        d = d < 0 ? -0.00001 : 0.00001
    }

    return u / d
}


export default diviProt
