// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PanelCode0} from "../src/code/PanelCode0.sol";
import {PanelCode1} from "../src/code/PanelCode1.sol";
import {PanelCode2} from "../src/code/PanelCode2.sol";
import {PanelCode3} from "../src/code/PanelCode3.sol";

/// Puts the panel art onchain: the four PanelCode data contracts, one transaction each. They hold bytes and nothing else;
/// no owner, no function. The swarm's launch then points PanelRenderer at these four addresses.
/// Before anything is sent, the simulated deploy is read back: the four pieces after their STOP bytes, in order, must be
/// the published art, its length and keccak256 below, or the script stops. Mainnet only, unless ANY_CHAIN=true.
///   forge script script/DeployArt.s.sol --rpc-url $MAINNET_RPC --account <keystore>                     # dry run
///   forge script script/DeployArt.s.sol --rpc-url $MAINNET_RPC --account <keystore> --broadcast --verify # Etherscan needs ETHERSCAN_API_KEY
contract DeployArt is Script {
    /// keccak256 of art/imd-panel.js.gz and its length in bytes.
    bytes32 constant SCRIPT_HASH = 0xd2c66890e2d2dc456f117c14ff12435ffc6fa56b73ab7955f0d838d8ae76cb76;
    uint256 constant SCRIPT_LENGTH = 87700;

    function run() external {
        require(block.chainid == 1 || vm.envOr("ANY_CHAIN", false), "not mainnet; set ANY_CHAIN=true to deploy here");
        vm.startBroadcast();
        address c0 = address(new PanelCode0());
        address c1 = address(new PanelCode1());
        address c2 = address(new PanelCode2());
        address c3 = address(new PanelCode3());
        vm.stopBroadcast();
        bytes memory art = bytes.concat(_tail(c0.code), _tail(c1.code), _tail(c2.code), _tail(c3.code));
        require(art.length == SCRIPT_LENGTH, "art length is not the published art's");
        require(keccak256(art) == SCRIPT_HASH, "art hash is not the published art's");
        console.log("PanelCode0", c0);
        console.log("PanelCode1", c1);
        console.log("PanelCode2", c2);
        console.log("PanelCode3", c3);
    }

    /// A piece's code after its leading STOP byte.
    function _tail(bytes memory code) private pure returns (bytes memory out) {
        out = new bytes(code.length - 1);
        for (uint256 i; i < out.length; ++i) out[i] = code[i + 1];
    }
}
