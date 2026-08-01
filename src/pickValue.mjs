import each from 'lodash-es/each.js'
import get from 'lodash-es/get.js'
import isString from 'lodash-es/isString.js'
import isNumber from 'lodash-es/isNumber.js'
import filter from 'lodash-es/filter.js'
import isearr from 'wsemi/src/isearr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import cdbl from 'wsemi/src/cdbl.mjs'


let pickValue = (arr, key) => {

    //check
    if (!isearr(arr)) {
        throw new Error('invalid arr')
    }
    if (!isestr(key)) {
        throw new Error('invalid key')
    }

    //close
    let rs = []
    each(arr, (v) => {

        //time
        let time = get(v, 'time', '')

        //check
        if (!isString(time)) {
            return true //跳出換下一個
        }

        //value
        let value = get(v, key, '')

        //check
        if (!isnum(value)) {
            return true //跳出換下一個
        }
        value = cdbl(value)

        //check
        if (Math.abs(value) > 1e15) {
            throw new Error(`invalid value[${value}]`)
        }

        //push
        rs.push({
            time,
            value,
        })

    })

    //filter
    let frs = filter(rs, (v) => {
        return isNumber(v.value)
    })

    return frs
}


export default pickValue
