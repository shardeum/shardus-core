{
  description = "Shardus core";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nixpkgs-node-18.url = "github:NixOS/nixpkgs/0cd51a933d91078775b300cf0f29aa3495231aa2";
    utils.url = "github:numtide/flake-utils";
    shardus-cli.url = "git+https://gitlab.com/shardus/tools/shardus-cli?ref=nix-flake";
    fenix.url = "github:nix-community/fenix";
  };

  outputs = {
    self,
    nixpkgs,
    nixpkgs-node-18,
    utils,
    shardus-cli,
    fenix,
    ...
  }: let
    appName = "shardus-core";
    out =
      utils.lib.eachDefaultSystem
      (system: let
        pkgs-node-18 = import nixpkgs-node-18 {inherit system;};
        pkgs = import nixpkgs {inherit system;};

        # build a custom nodejs at version 18.16.1
        buildNodeJs = pkgs-node-18.callPackage "${nixpkgs-node-18}/pkgs/development/web/nodejs/nodejs.nix" {python = pkgs-node-18.python3;};
        custom-nodejs = buildNodeJs {
          enableNpm = true;
          version = "18.16.1";
          sha256 = "0wp2xyz5yqcvb6949xaqpan73rfhdc3cdfsvx7vzvzc9in64yh78";
        };

        # also pin rust to 1.74.1
        custom-rust = fenix.packages.${system}.toolchainOf {
          channel = "1.74.1";
          sha256 = "sha256-PjvuouwTsYfNKW5Vi5Ye7y+lL7SsWGBxCtBOOm2z14c=";
        };

        nativeBuildInputs = [custom-rust.toolchain];
        buildInputs = [custom-nodejs];
      in {
        # `nix develop` or direnv
        devShell = pkgs.mkShell {
          packages =
            nativeBuildInputs
            ++ buildInputs
            ++ [shardus-cli.packages.${system}.default]
            ++ (with pkgs.nodePackages; [
              typescript-language-server
              vscode-langservers-extracted
              prettier
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
