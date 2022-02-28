# Shardus Core

The foundational technology upon which all Shardus applications are built

## Installation

Installing this is mostly like usual:

```sh
npm install
```

However, there's one consideration. For the time being, you need to have [the rust toolchain](https://opensource.com/article/20/3/rust-cargo).
We're working on a fix for this, but for now you'll need it. Specifically, `cargo` must be in your `PATH`.

## Releasing

If you are a core developer on this project, you may sometimes want to cut a release.
Doing so should be easy-peasy:

```sh
npm run release
```

and it'll walk you through the steps to release the package.

Note: You need to be running the correct version of node (to the T) in order to cut a release.
The correct version is whatever is listed in the package.json engines.node property, which should
be the same as in the docs. The script won't allow you to, but if you built it with a different
version of node, everyone who wants to run it would have to switch as well, as bytenode requires
you to use the exact same version of node to run it as to build it.

## Building / Developing

If you want to build the project in order to develop off this source code, run:

```sh
npm run build:dev
```

This will build the dist/ folder with the source code compiled from ts to js, but not
to bytecode.

Personally, I run this command when I'm working on this repo. I usually have a watcher setup
so it builds on every change:

```sh
nodemon -e ts,json -x 'npm run build:dev'
```

and then I link this project from a project that uses it:

package.json
```json
{
  ...
  "dependencies": {
    "@shardus/core": "../shardus-core"
  },
  ...
}
```

and then that project will be using the javascript version of this after every
keystroke. Note that the same thing can be accomplished using `npm link` in lieu
of using the `../shardus-core` style syntax.

If you want to run off of the fully compiled release version of your current code,
you can replace the `build:dev` from above with `build:release`. This will compile
it into bytecode.

Note: Running any of the `build:` prefixed commands _will not attempt to publish anything
to npm_. It won't build a tarball or anything like that, it just populates the `dist/` directory.
You can run these commands safely as often as you wish.
