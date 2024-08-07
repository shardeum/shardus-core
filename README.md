# Shardus Core

The foundational technology upon which all Shardus applications are built

## Install

You can install Shardus Core via npm:

```sh
npm i @shardus/core
```

## Installing and Building Locally

Make sure you have Node.js and npm installed on your system. Run the following command to install the necessary dependencies:

```sh
npm install
```

> Please note that you need to have the [Rust toolchain](https://opensource.com/article/20/3/rust-cargo) installed. We're working on a fix for this, but for now you'll need it. Specifically, `cargo` must be in your `PATH`.

For building the project, run the following command:

```sh
npm run build:dev
```

This will build the `dist/` folder with the source code compiled from typescript to javascript, but not to bytecode.

Optionally, you can set up a watcher to automatically build the project on every change:

```sh
nodemon -e ts,json -x 'npm run build:dev'
```

Additionally, you can link this project from another project using the following syntax in the `package.json` file:

```json
{
  ...
  "dependencies": {
    "@shardus/core": "../shardus-core"
  },
  ...
}
```

and then that project will be using the javascript version of this after every keystroke. Note that the same thing can be accomplished using `npm link` in lieu of using the `../shardus-core` style syntax.

If you prefer to run off the fully compiled release version of your current code, replace `build:dev` with `build:release`. This will compile the code into bytecode.

> Note: Running any of the `build:` prefixed commands will not publish anything to npm. They simply populate the `dist/` directory with the compiled code. You can run these commands safely as often as you wish.

## Releasing

If you're a core developer on this project and need to cut a release, simply run:

```sh
npm run release
```

This command will guide you through the steps necessary to release the package.

> Note: Ensure that you're using the correct version of Node.js as specified in the `package.json` file under the engines.node property. Using a different version may cause compatibility issues.

## Contributing

Contributions are very welcome! Everyone interacting in our codebases, issue trackers, and any other form of communication, including chat rooms and mailing lists, is expected to follow our [code of conduct](./CODE_OF_CONDUCT.md) so we can all enjoy the effort we put into this project.
