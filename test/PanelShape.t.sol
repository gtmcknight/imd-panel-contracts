// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PanelRenderer, ISeats, IPanelDesigns} from "../src/PanelRenderer.sol";
import {PanelDesigns} from "../src/PanelDesigns.sol";

/// What the contracts must not have: nothing beyond the listed functions, no fallback or receive, no way to change code or
/// hand control to other code, and a renderer that never writes and reads nothing of the block or the caller. Read from
/// the compiled artifacts and the deployed bytecode, so an extra owner, setter, upgrade path or self-destruct fails here,
/// whatever it is called.
contract PanelShapeTest is Test {
    function test_designsHasExactlyTheListedFunctions() public view {
        string[] memory want = new string[](4);
        want[0] = "clearDesign()";
        want[1] = "designOf(address)";
        want[2] = "designsOf(address[])";
        want[3] = "setDesign(bytes32)";
        _exactly("out/PanelDesigns.sol/PanelDesigns.json", want);
    }

    function test_rendererHasExactlyTheListedFunctions() public view {
        string[] memory want = new string[](8);
        want[0] = "SEAT_COUNT()";
        want[1] = "chunks()";
        want[2] = "designs()";
        want[3] = "owners()";
        want[4] = "panelOf(address)";
        want[5] = "script()";
        want[6] = "scriptHash()";
        want[7] = "seats()";
        _exactly("out/PanelRenderer.sol/PanelRenderer.json", want);
    }

    function test_designsHasNoDangerousOpcodes() public {
        // PanelDesigns writes storage (a wallet's own word), and calls nothing
        _forbid(address(new PanelDesigns()).code, "out/PanelDesigns.sol/PanelDesigns.json", false);
    }

    function test_rendererHasNoDangerousOpcodes() public {
        address a = _write(hex"aa");
        PanelRenderer r = new PanelRenderer(ISeats(address(1)), IPanelDesigns(address(2)), a, a, a, a, keccak256(hex"aaaaaaaa"));
        // the renderer reads other contracts, so STATICCALL is allowed
        _forbid(address(r).code, "out/PanelRenderer.sol/PanelRenderer.json", true);
    }

    /// The renderer keeps nothing in storage, only immutables (and its bytecode has no SSTORE or TSTORE, above); PanelDesigns
    /// keeps one mapping.
    function test_storageIsOnlyTheDesigns() public view {
        assertFalse(vm.keyExistsJson(vm.readFile("out/PanelRenderer.sol/PanelRenderer.json"), ".storageLayout.storage[0]"), "renderer storage");
        string memory d = vm.readFile("out/PanelDesigns.sol/PanelDesigns.json");
        assertTrue(vm.keyExistsJson(d, ".storageLayout.storage[0]"), "designs storage");
        assertFalse(vm.keyExistsJson(d, ".storageLayout.storage[1]"), "designs has one variable");
        assertEq(vm.parseJsonString(d, ".storageLayout.storage[0].label"), "designOf");
    }

    // ---- helpers ----

    /// The listed functions and no others, and no fallback or receive: a call to any other selector, or with value, reverts.
    function _exactly(string memory artifact, string[] memory want) private view {
        string memory json = vm.readFile(artifact);
        string[] memory got = vm.parseJsonKeys(json, ".methodIdentifiers");
        assertEq(got.length, want.length, "function count");
        for (uint256 i; i < want.length; ++i) {
            bool found;
            for (uint256 j; j < got.length && !found; ++j) found = keccak256(bytes(got[j])) == keccak256(bytes(want[i]));
            assertTrue(found, want[i]);
        }
        for (uint256 i; vm.keyExistsJson(json, string.concat(".abi[", vm.toString(i), "]")); ++i) {
            bytes32 kind = keccak256(bytes(vm.parseJsonString(json, string.concat(".abi[", vm.toString(i), "].type"))));
            assertTrue(kind != keccak256("fallback"), "fallback");
            assertTrue(kind != keccak256("receive"), "receive");
        }
    }

    /// Walks the runtime code instruction by instruction, PUSH data skipped, and fails on SELFDESTRUCT, DELEGATECALL,
    /// CALLCODE, CALL, CREATE, CREATE2 and TSTORE. `reader` is the renderer: it may STATICCALL, and may not write storage
    /// or read anything that changes with the block, the caller or the transaction.
    /// Bytes no execution can reach are passed over: after STOP, JUMP, RETURN, REVERT or INVALID, up to the next JUMPDEST.
    /// That is where solc keeps data, such as the renderer's base64 table. The walk splits instructions as the EVM's own
    /// jump analysis does, so a JUMPDEST it reads as PUSH data is no jump target either.
    function _forbid(bytes memory code, string memory artifact, bool reader) private view {
        uint256 end = _codeEnd(code, vm.parseJsonBytes(vm.readFile(artifact), ".deployedBytecode.object"));
        bool live = true;
        for (uint256 i; i < end; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) { i += op - 0x5f; continue; }
            if (op == 0x5b) live = true;
            if (!live) continue;
            if (op == 0x00 || op == 0x56 || op == 0xf3 || op == 0xfd || op == 0xfe) { live = false; continue; }
            require(op != 0xff, "SELFDESTRUCT");
            require(op != 0xf4, "DELEGATECALL");
            require(op != 0xf2, "CALLCODE");
            require(op != 0xf0 && op != 0xf5, "CREATE");
            require(op != 0xf1, "CALL");
            require(op != 0x5d, "TSTORE");
            if (!reader) {
                require(op != 0xfa, "STATICCALL");
                continue;
            }
            require(op != 0x55, "SSTORE");
            require(op != 0x42, "TIMESTAMP");
            require(op != 0x43, "NUMBER");
            require(op != 0x44, "PREVRANDAO");
            require(op != 0x40, "BLOCKHASH");
            require(op != 0x41, "COINBASE");
            require(op != 0x32, "ORIGIN");
            require(op != 0x33, "CALLER");
            require(op != 0x3a, "GASPRICE");
            require(op != 0x48, "BASEFEE");
            require(op != 0x49, "BLOBHASH");
        }
    }

    /// Where the instructions end. solc's metadata (a CBOR map opening with an "ipfs" or "solc" key, then its 2-byte
    /// length) is cut off only when the deployed code ends with exactly the compiler's own, from the artifact: its hash
    /// covers the source, so code hidden there cannot match it. Otherwise every byte is walked.
    function _codeEnd(bytes memory code, bytes memory built) private pure returns (uint256) {
        uint256 n = built.length;
        if (n < 2 || code.length < n) return code.length;
        uint256 meta = (uint256(uint8(built[n - 2])) << 8) | uint8(built[n - 1]);
        if (meta < 6 || meta + 2 > n) return code.length;
        uint256 at = n - 2 - meta;
        if ((built[at] != 0xa1 && built[at] != 0xa2) || built[at + 1] != 0x64) return code.length;
        bytes4 key = bytes4(bytes.concat(built[at + 2], built[at + 3], built[at + 4], built[at + 5]));
        if (key != "ipfs" && key != "solc") return code.length;
        uint256 cut = code.length - meta - 2;
        for (uint256 i; i < meta + 2; ++i) if (code[cut + i] != built[at + i]) return code.length;
        return cut;
    }

    function _write(bytes memory data) private returns (address p) {
        bytes memory init = abi.encodePacked(hex"600B5981380380925939F3", hex"00", data);
        assembly { p := create(0, add(init, 32), mload(init)) }
    }
}
