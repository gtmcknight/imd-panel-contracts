// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PanelRenderer, ISeats, IPanelDesigns} from "../src/PanelRenderer.sol";
import {PanelDesigns} from "../src/PanelDesigns.sol";

/// Seats 0..1999; seat 3 and 7 held by one wallet, seat 5 burned (ownerOf reverts), the rest by another.
contract MockSeats is ISeats {
    address public immutable holder;
    address public immutable others;
    constructor(address h, address o) { holder = h; others = o; }
    function ownerOf(uint256 id) external view returns (address) {
        require(id < 2000 && id != 5, "no token");
        return id == 3 || id == 7 ? holder : others;
    }
}

/// Answers ownerOf in every way a seats contract can go wrong, by id % 6: short data, nothing, a revert, a word with its
/// upper bits set, a clean address, and a clean address with extra bytes after it. Only the last two are holders.
contract OddSeats {
    fallback() external {
        uint256 id = abi.decode(msg.data[4:], (uint256));
        address a = address(uint160(0x5EA7 + id));
        assembly {
            mstore(0, a)
            mstore(32, not(0))
            switch mod(id, 6)
            case 0 { return(0, 31) }
            case 1 { return(0, 0) }
            case 2 { revert(0, 0) }
            case 3 { mstore(0, or(shl(160, 1), a)) return(0, 32) }
            case 4 { return(0, 32) }
            default { return(0, 64) }
        }
    }
}

/// The page, as the README writes it, from its five parts.
library Page {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function html(bytes memory code, bytes memory owners, address wallet, bytes32 word, uint256 chainId) internal pure returns (string memory) {
        string memory w = hexOf(abi.encodePacked(wallet));
        return string.concat(
            '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
            "<title>IMD panel ", w,
            '</title></head><body><script>(async()=>{const z=Uint8Array.from(atob("', vm.toBase64(code),
            '"),c=>c.charCodeAt(0));const t=await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream("gzip"))).text();(0,eval)(t);IMD.panel("',
            vm.toBase64(owners), '","', w, '","', hexOf(abi.encodePacked(word)), '",', vm.toString(chainId),
            ")})()</script></body></html>"
        );
    }

    function hexOf(bytes memory b) internal pure returns (string memory) {
        bytes memory s = new bytes(2 + b.length * 2);
        bytes16 d = "0123456789abcdef";
        (s[0], s[1]) = ("0", "x");
        for (uint256 i; i < b.length; ++i) { s[2 + i * 2] = d[uint8(b[i]) >> 4]; s[3 + i * 2] = d[uint8(b[i]) & 15]; }
        return string(s);
    }
}

contract PanelRendererTest is Test {
    PanelRenderer renderer;
    PanelDesigns designs;
    MockSeats seats;
    address[4] pieces;
    address holder = address(0xA11CE);
    bytes code = hex"1f8b0800000000000203cb48cdc9c95728cf2fca490100c2a99ae70b000000"; // gzip("hello world")

    function setUp() public {
        designs = new PanelDesigns();
        seats = new MockSeats(holder, address(0xB0B));
        // the code in four uneven pieces, in order, as the real deploy has it
        pieces = [_write(_slice(code, 0, 10)), _write(_slice(code, 10, 1)), _write(_slice(code, 11, 15)), _write(_slice(code, 26, code.length - 26))];
        renderer = new PanelRenderer(seats, IPanelDesigns(address(designs)), pieces[0], pieces[1], pieces[2], pieces[3], keccak256(code));
    }

    function test_scriptIsTheChunksInOrderAndItsHashIsPublished() public view {
        assertEq(renderer.script(), code);
        assertEq(renderer.scriptHash(), keccak256(code));
        address[] memory c = renderer.chunks();
        assertEq(c.length, 4);
        for (uint256 i; i < 4; ++i) assertEq(c[i], pieces[i]);
        assertEq(address(renderer.seats()), address(seats));
        assertEq(address(renderer.designs()), address(designs));
    }

    function test_ownersPacksEverySeatAndZeroesMissingOnes() public view {
        bytes memory o = renderer.owners();
        assertEq(o.length, 2000 * 20);
        assertEq(_at(o, 3), holder);
        assertEq(_at(o, 7), holder);
        assertEq(_at(o, 5), address(0));
        assertEq(_at(o, 0), address(0xB0B));
        assertEq(_at(o, 1999), address(0xB0B));
    }

    /// A seat is a holder only when ownerOf succeeds with at least a word, and that word is an address.
    function test_ownersZeroesAnythingThatIsNotAnAddress() public {
        bytes memory o = _rendererOver(ISeats(address(new OddSeats()))).owners();
        assertEq(o.length, 2000 * 20);
        for (uint256 i; i < 2000; ++i) assertEq(_at(o, i), i % 6 >= 4 ? address(uint160(0x5EA7 + i)) : address(0));
    }

    /// Seats at an address with no code: every seat empty, not a revert.
    function test_ownersFromAnAddressWithNoCodeIsAllZero() public {
        bytes memory o = _rendererOver(ISeats(address(0xC0FFEE))).owners();
        assertEq(keccak256(o), keccak256(new bytes(2000 * 20)));
    }

    function test_panelCarriesTheWalletAndItsDesign() public {
        bytes32 word = bytes32(uint256(0x0200040000000000000000000000000000000000000000000000000000000000));
        vm.prank(holder);
        designs.setDesign(word);
        string memory html = renderer.panelOf(holder);
        assertTrue(_has(html, "0x00000000000000000000000000000000000a11ce"));
        assertTrue(_has(html, "0x0200040000000000000000000000000000000000000000000000000000000000"));
        assertTrue(_has(html, "DecompressionStream"));
    }

    /// The page, byte for byte: the site's drawing code reads exactly this, so nothing in it may differ, whoever asks,
    /// whatever the design, on any chain, at any block and time.
    function testFuzz_pageIsExactlyTheTemplate(address wallet, bytes32 word, uint64 chainId, uint256 time, uint256 height) public {
        vm.prank(wallet);
        designs.setDesign(word);
        vm.chainId(chainId);
        vm.warp(time);
        vm.roll(height);
        assertEq(renderer.panelOf(wallet), Page.html(code, renderer.owners(), wallet, word, chainId));
    }

    function test_rejectsAnEmptyChunk() public {
        address a = _write(hex"aa");
        vm.expectRevert(abi.encodeWithSelector(PanelRenderer.EmptyChunk.selector, 2));
        new PanelRenderer(ISeats(address(1)), IPanelDesigns(address(designs)), a, a, address(0xdead), a, bytes32(0));
        // a piece holding only its STOP byte is empty too, and the first empty one is named
        address stop = _write("");
        vm.expectRevert(abi.encodeWithSelector(PanelRenderer.EmptyChunk.selector, 1));
        new PanelRenderer(ISeats(address(1)), IPanelDesigns(address(designs)), a, stop, a, address(0xdead), bytes32(0));
    }

    function test_rejectsCodeWhoseHashIsNotTheOneGiven() public {
        address a = _write(hex"aa");
        vm.expectRevert(abi.encodeWithSelector(PanelRenderer.WrongScript.selector, keccak256(hex"aaaaaaaa")));
        new PanelRenderer(ISeats(address(1)), IPanelDesigns(address(designs)), a, a, a, a, keccak256("something else"));
    }

    function _rendererOver(ISeats s) private returns (PanelRenderer) {
        return new PanelRenderer(s, IPanelDesigns(address(designs)), pieces[0], pieces[1], pieces[2], pieces[3], keccak256(code));
    }

    function _write(bytes memory data) private returns (address p) {
        bytes memory init = abi.encodePacked(hex"600B5981380380925939F3", hex"00", data);
        assembly { p := create(0, add(init, 32), mload(init)) }
    }

    function _slice(bytes memory b, uint256 from, uint256 len) private pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; ++i) out[i] = b[from + i];
    }

    function _at(bytes memory o, uint256 seat) private pure returns (address a) {
        assembly { a := shr(96, mload(add(add(o, 32), mul(seat, 20)))) }
    }

    function _has(string memory s, string memory part) private pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(part);
        if (b.length > a.length) return false;
        for (uint256 i; i <= a.length - b.length; ++i) {
            bool ok = true;
            for (uint256 j; j < b.length && ok; ++j) ok = a[i + j] == b[j];
            if (ok) return true;
        }
        return false;
    }
}
