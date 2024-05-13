import { setupTestEnvironment } from './utils/setup'
import { ApopotosizeInternalApiTest } from './functions/ApoptosizeInternalApiTest'
import { GetAccountDataInternalApiTest } from './functions/GetAccountDataInternalApiTest'
import { NetworkClass } from '../../src/network'

let myNetworkContext: NetworkClass
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const errorTests = results.filter((result) => result.result === 'Error').length
    console.log(`\x1b[32mPassed: ${passedTests}\x1b[0m`) // Green for passed tests
    console.log(`\x1b[33mFailed: ${failedTests}\x1b[0m`) // Yellow for failed tests
    console.log(`\x1b[31mErrors: ${errorTests}\x1b[0m`) // Red for error tests
  }
}

async function runIntegrationTests(): Promise<void> {
  try {
    // Setup the environment
    const { dummyNode, targetNode, networkContext } = await setupTestEnvironment()
    myNetworkContext = networkContext

    console.log('Running integration tests...')
    console.log('----------------------------------------------------------------------------------------')
    console.log('----------------------------------------------------------------------------------------')

    // Run all integration tests or individual tests by commenting out the other
    await ApopotosizeInternalApiTest(dummyNode, targetNode)
    await GetAccountDataInternalApiTest(dummyNode, targetNode)
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
