import get from 'lodash-es/get.js'


let diviProt = (u, d, opt = {}) => {

    let plusDenominator = get(opt, 'plusDenominator', 0)

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
