const NS_PER_SEC = 1e9

// process.hrtime.bigint()

interface Profiler {
  sectionTimes: any
}

class Profiler {
  constructor() {
    this.sectionTimes = {}
  }

  profileSectionStart(sectionName) {
    let section = this.sectionTimes[sectionName]
    if (section == null) {
      let t = BigInt(0)
      section = { name: sectionName, total: t, c: 0 }
      this.sectionTimes[sectionName] = section
    }
    section.start = process.hrtime.bigint()
    section.started = true
    section.c++
  }

  profileSectionEnd(sectionName) {
    let section = this.sectionTimes[sectionName]
    if (section == null || section.started === false) {
      return
    }

    section.end = process.hrtime.bigint()

    section.total += section.end - section.start
    section.started = false
  }

  cleanInt(x) {
    x = Number(x)
    return x >= 0 ? Math.floor(x) : Math.ceil(x)
  }

  printAndClearReport(delta?: number) {
    let result = 'Profile Sections: '
    // let d1 = this.cleanInt(delta * NS_PER_SEC)
    let d1 = this.cleanInt(1e6) // will get us ms
    let divider = BigInt(d1)
    // console.log('divider: ' + divider)
    for (let key in this.sectionTimes) {
      if (this.sectionTimes.hasOwnProperty(key)) {
        let section = this.sectionTimes[key]
        result += `${section.name}: total ${section.total /
          divider} avg:${section.total / (divider * BigInt(section.c))} ,  ` // ${section.total} :
        section.total = BigInt(0)
      }
    }

    console.log(result)
  }
}
export default Profiler
