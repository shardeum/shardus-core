import { setupTestEnvironment } from './utils/setup'
import { ApopotosizeInternalApiTest } from './functions/ApoptosizeInternalApiTest'
import { GetAccountDataInternalApiTest } from './functions/GetAccountDataInternalApiTest'
import { ShardusTypes } from '../../src/shardus'
import { NetworkClass } from '../../src/network'
import { exec } from 'child_process'

let myNode: ShardusTypes.Node
let myNetworkContext: NetworkClass
let testInternalPort: number
let testExternalPort: number
const results: any[] = []

export const addResult = (testType: string, name: string, result: string, time: number): void => {
  results.push({ testType, name, result, time })
}

const displayResults = (): void => {
  if (results.length === 0) {
    console.log('No results to display.')
  } else {
    console.table(
      results.map((result) => ({
        'Test Type': result.testType,
        Name: result.name,
        Result: result.result,
        Time: `${result.time}ms`,
      }))
    )

    const passedTests = results.filter((result) => result.result === 'Pass').length
    const failedTests = results.filter((result) => result.result === 'Fail').length
    console.log(`\x1b[32mPassed: ${passedTests}\x1b[0m`) // Green for passed tests
    console.log(`\x1b[31mFailed: ${failedTests}\x1b[0m`) // Red for failed tests
  }
}

async function runIntegrationTests(): Promise<void> {
  try {
    // Setup the environment
    const { node, networkContext, internalPort, externalPort } = await setupTestEnvironment()
    myNode = node
    myNetworkContext = networkContext
    testInternalPort = internalPort
    testExternalPort = externalPort

    console.log('Running integration tests...')
    console.log('----------------------------------------------------------------------------------------')
    console.log('----------------------------------------------------------------------------------------')

    // Run all integration tests or individual tests by commenting out the other
    await ApopotosizeInternalApiTest(myNode)
    await GetAccountDataInternalApiTest(myNode)
  } catch (error) {
    console.error('Error during integration tests:', error)
  } finally {
    // Display the results
    displayResults()
    console.log('----------------------------------------------------------------------------------------')
    console.log('----------------------------------------------------------------------------------------')
    // Shutdown the network
    await myNetworkContext.shutdown()
    process.exit(0)
  }
}

// Execute the tests
runIntegrationTests()
