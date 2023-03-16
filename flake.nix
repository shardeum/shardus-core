{
  description = "Shardus core";

  inputs = {
    naersk.url = "github:nmattia/naersk/master";
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    utils.url = "github:numtide/flake-utils";
    shardus-cli.url = "git+https://gitlab.com/shardus/tools/shardus-cli?ref=nix-flake";
  };

  outputs = {
    self,
    nixpkgs,
    naersk,
    shardus-cli,
    utils,
  }: let
    appName = "shardus-core";
    out =
      utils.lib.eachDefaultSystem
      (system: let
        pkgs = import nixpkgs {
          inherit system;
        };
        naersk-lib = naersk.lib."${system}";
        buildNodeJs = pkgs.callPackage "${nixpkgs}/pkgs/development/web/nodejs/nodejs.nix" {python = pkgs.python3;};
        custom-nodejs = buildNodeJs {
          enableNpm = true;
          version = "16.11.1";
          sha256 = "0y32mdv8zs35la2bny8d9rxjvj1vr8z079ji1g6ajc2yw96pyn37";
        };

        nativeBuildInputs = with pkgs; [
          cargo
          rustc
          pkg-config

          custom-nodejs
        ];
        buildInputs = with pkgs; [];
      in {
        # `nix build`
        defaultPackage = naersk-lib.buildPackage {
          pname = appName;
          root = builtins.path {
            path = ./.;
            name = "${appName}-src";
          };
          inherit nativeBuildInputs buildInputs;
        };

        # `nix run`
        defaultApp = utils.lib.mkApp {
          name = appName;
          drv = self.defaultPackage."${system}";
          exePath = "/bin/${appName}";
        };

        # `nix develop` or direnv
        devShell = pkgs.mkShell {
          packages =
            nativeBuildInputs
            ++ buildInputs
            ++ (with pkgs; [
              cargo-watch
              clippy
              rust-analyzer
              rustfmt

              nodePackages.typescript-language-server
              nodePackages.vscode-langservers-extracted
              nodePackages.prettier

              shardus-cli.packages.${system}.default
            ]);
        };
      });
  in
    out
    // {
      overlay = final: prev: {
        ${appName} = self.defaultPackage.${prev.system};
      };
    };
}
