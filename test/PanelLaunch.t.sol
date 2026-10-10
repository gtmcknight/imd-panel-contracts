// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PanelRenderer, ISeats, IPanelDesigns} from "../src/PanelRenderer.sol";
import {PanelDesigns} from "../src/PanelDesigns.sol";
import {PanelCode0} from "../src/code/PanelCode0.sol";
import {PanelCode1} from "../src/code/PanelCode1.sol";
import {PanelCode2} from "../src/code/PanelCode2.sol";
import {PanelCode3} from "../src/code/PanelCode3.sol";
import {Page} from "./PanelRenderer.t.sol";

// The published art: keccak256 of art/imd-panel.js.gz and its length in bytes. When the art changes, these two change,
// and nothing else in the tests.
bytes32 constant SCRIPT_HASH = 0xd2c66890e2d2dc456f117c14ff12435ffc6fa56b73ab7955f0d838d8ae76cb76;
uint256 constant SCRIPT_LENGTH = 87700;
// A panelOf read must stay inside what public nodes allow an eth_call.
uint256 constant READ_GAS = 30_000_000;

/// Every seat held, two by the wallet under test.
contract FullSeats is ISeats {
    function ownerOf(uint256 id) public pure returns (address) {
        require(id < 2000, "no token");
        return id == 12 || id == 13 ? address(0xA11CE) : address(uint160(0x1000 + id / 4));
    }
}

/// The same holders, each kept in its own storage slot, as a real collection keeps them: every read is a cold SLOAD.
contract StoredSeats is ISeats {
    mapping(uint256 => address) holderOf;

    constructor() {
        FullSeats f = new FullSeats();
        for (uint256 i; i < 2000; ++i) holderOf[i] = f.ownerOf(i);
    }

    function ownerOf(uint256 id) external view returns (address a) {
        a = holderOf[id];
        require(a != address(0), "no token");
    }
}

/// The deploy as it will run: the four art pieces first, then one launch of PanelDesigns and PanelRenderer, each
/// transaction under the per-transaction gas cap, and a renderer that serves exactly the published code.
contract PanelLaunchTest is Test {
    /// A transaction is capped at 2^24 gas (EIP-7825). Kept well under for the launch's own overhead.
    uint256 constant LAUNCH_GAS = 14_000_000;

    /// The art goes onchain first, one piece a transaction, each well under the cap.
    function test_art_eachPieceFitsOneTransaction() public {
        uint256 g;
        g = gasleft(); new PanelCode0(); _under(g, "PanelCode0");
        g = gasleft(); new PanelCode1(); _under(g, "PanelCode1");
        g = gasleft(); new PanelCode2(); _under(g, "PanelCode2");
        g = gasleft(); new PanelCode3(); _under(g, "PanelCode3");
    }

    /// Then the launch: PanelDesigns and PanelRenderer together, the art's addresses as fixed arguments.
    function test_launch_designsAndRendererFitOneTransaction() public {
        address c0 = address(new PanelCode0());
        address c1 = address(new PanelCode1());
        address c2 = address(new PanelCode2());
        address c3 = address(new PanelCode3());
        FullSeats seats = new FullSeats();
        uint256 g = gasleft();
        PanelDesigns designs = new PanelDesigns();
        PanelRenderer r = new PanelRenderer(seats, IPanelDesigns(address(designs)), c0, c1, c2, c3, SCRIPT_HASH);
        uint256 used = g - gasleft();
        emit log_named_uint("launch gas", used);
        assertLt(used, LAUNCH_GAS);
        assertEq(r.scriptHash(), SCRIPT_HASH);
        address[] memory c = r.chunks();
        assertEq(c.length, 4);
        address[4] memory want = [c0, c1, c2, c3];
        for (uint256 i; i < 4; ++i) assertEq(c[i], want[i]);
        assertEq(address(r.seats()), address(seats));
        assertEq(address(r.designs()), address(designs));
    }

    function _under(uint256 g, string memory name) private {
        uint256 used = g - gasleft();
        emit log_named_uint(name, used);
        assertLt(used, LAUNCH_GAS);
    }

    function test_rendererServesExactlyThePublishedCode() public {
        PanelRenderer r = _deploy();
        bytes memory code = r.script();
        assertEq(code.length, SCRIPT_LENGTH);
        assertEq(keccak256(code), SCRIPT_HASH);
        // gzip's magic bytes, first: the pieces are in order
        assertEq(uint8(code[0]), 0x1f);
        assertEq(uint8(code[1]), 0x8b);
    }

    function test_rendererRefusesThePiecesOutOfOrder() public {
        address c0 = address(new PanelCode0());
        address c1 = address(new PanelCode1());
        address c2 = address(new PanelCode2());
        address c3 = address(new PanelCode3());
        FullSeats seats = new FullSeats();
        IPanelDesigns designs = IPanelDesigns(address(new PanelDesigns()));
        PanelRenderer r = new PanelRenderer(seats, designs, c1, c0, c2, c3, SCRIPT_HASH);
        vm.expectPartialRevert(PanelRenderer.WrongScript.selector);
        r.script();
        vm.expectPartialRevert(PanelRenderer.WrongScript.selector);
        r.panelOf(address(0xA11CE));
    }

    /// The page over the real art, byte for byte, whoever asks, whatever the design, on any chain, at any block and time.
    /// The code in it is the four pieces read directly, in order, and is the published code.
    /// forge-config: default.fuzz.runs = 16
    function testFuzz_realPageIsExactlyTheTemplate(address wallet, bytes32 word, uint64 chainId, uint256 time, uint256 height) public {
        PanelDesigns designs = new PanelDesigns();
        address[4] memory c = [address(new PanelCode0()), address(new PanelCode1()), address(new PanelCode2()), address(new PanelCode3())];
        PanelRenderer r = new PanelRenderer(new FullSeats(), IPanelDesigns(address(designs)), c[0], c[1], c[2], c[3], SCRIPT_HASH);
        bytes memory code;
        for (uint256 i; i < 4; ++i) code = bytes.concat(code, _afterFirstByte(c[i].code));
        assertEq(code.length, SCRIPT_LENGTH);
        assertEq(keccak256(code), SCRIPT_HASH);
        vm.prank(wallet);
        designs.setDesign(word);
        vm.chainId(chainId);
        vm.warp(time);
        vm.roll(height);
        assertEq(r.panelOf(wallet), Page.html(code, r.owners(), wallet, word, chainId));
    }

    function _afterFirstByte(bytes memory b) private pure returns (bytes memory out) {
        out = new bytes(b.length - 1);
        for (uint256 i; i < out.length; ++i) out[i] = b[i + 1];
    }

    function _deploy() private returns (PanelRenderer) {
        return new PanelRenderer(new FullSeats(), IPanelDesigns(address(new PanelDesigns())),
            address(new PanelCode0()), address(new PanelCode1()), address(new PanelCode2()), address(new PanelCode3()), SCRIPT_HASH);
    }
}

/// panelOf against seats kept in storage, as on mainnet, read as an eth_call reads them: every account and slot cold.
/// foundry.toml sets `isolate`, so each call the test makes is its own transaction and nothing setUp touched is warm. The
/// same read over FullSeats, which keeps no storage, shows the measured one paid for every cold slot.
contract PanelReadGasTest is Test {
    PanelRenderer stored;
    PanelRenderer bare;

    function setUp() public {
        IPanelDesigns designs = IPanelDesigns(address(new PanelDesigns()));
        address[4] memory c = [address(new PanelCode0()), address(new PanelCode1()), address(new PanelCode2()), address(new PanelCode3())];
        stored = new PanelRenderer(new StoredSeats(), designs, c[0], c[1], c[2], c[3], SCRIPT_HASH);
        bare = new PanelRenderer(new FullSeats(), designs, c[0], c[1], c[2], c[3], SCRIPT_HASH);
    }

    function test_panelOfAWalletReadsWithinAnEthCall() public {
        (uint256 used, uint256 size) = _read(stored, address(0xA11CE));
        (uint256 base,) = _read(bare, address(0xA11CE));
        emit log_named_uint("panelOf gas", used);
        emit log_named_uint("panelOf gas, seats without storage", base);
        emit log_named_uint("panelOf bytes", size);
        assertLt(used, READ_GAS);
        // 2,000 slots, each a cold SLOAD (2,100); read warm (100) they would cost next to nothing
        assertGt(used, base + 3_000_000, "seats read warm");
        // the ABI string: offset, length, the page
        assertGt(size, 100_000);
    }

    /// The call's gas, its returned data left uncopied so the caller's memory does not count.
    function _read(PanelRenderer r, address wallet) private view returns (uint256 used, uint256 size) {
        bytes memory data = abi.encodeCall(PanelRenderer.panelOf, (wallet));
        address to = address(r);
        assembly {
            let g := gas()
            if iszero(staticcall(gas(), to, add(data, 32), mload(data), 0, 0)) { revert(0, 0) }
            used := sub(g, gas())
            size := returndatasize()
        }
    }
}
