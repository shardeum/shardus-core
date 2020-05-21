#!/usr/bin/env bash

docker run --platform linux/arm/v7 -it --rm -w /usr/src/app -v $(pwd):/usr/src/app --entrypoint /usr/local/bin/npm node:12 run update-dist-arm
sudo chown -R $(whoami):$(whoami) dist/