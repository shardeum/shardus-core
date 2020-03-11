const path = require('path')
const nodeExternals = require('webpack-node-externals')
const BytenodeWebpackPlugin = require('bytenode-webpack-plugin')

module.exports = {
  entry: './build/src/index.js',
  output: {
    filename: 'shardus.js',
    path: path.resolve(__dirname, process.env.npm_package_config_dist),
    libraryTarget: 'commonjs2'
  },
  target: 'node',
  externals: [nodeExternals()],
  node: {
    __dirname: false,
    __filename: false
  },
  mode: 'production',
  plugins: [new BytenodeWebpackPlugin()]
}
