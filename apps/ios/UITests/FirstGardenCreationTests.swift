import XCTest

@MainActor
final class FirstGardenCreationTests: XCTestCase {
    func testCreatesFirstGardenFromCleanStateAndPersistsAfterRelaunch() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-first-garden", "--ui-test-reset", "-AppleLanguages", "(en)"]
        app.launchEnvironment["VERDERY_UI_TEST_RUN_ID"] = UUID().uuidString
        app.launch()

        let empty = app.descendants(matching: .any)["gardens.empty"].firstMatch
        let isEmpty = empty.waitForExistence(timeout: 15)
        if !isEmpty { print(app.debugDescription) }
        XCTAssertTrue(isEmpty)
        app.buttons["gardens.create.open"].tap()
        let submit = app.buttons["gardens.create.submit"]
        XCTAssertTrue(submit.waitForExistence(timeout: 5))
        XCTAssertFalse(submit.isEnabled)

        let name = app.textFields["gardens.create.nameField"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("R02 First Garden")
        XCTAssertTrue(submit.isEnabled)
        submit.tap()

        let garden = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'gardens.row.'")).firstMatch
        XCTAssertTrue(garden.waitForExistence(timeout: 10))
        XCTAssertTrue(garden.label.contains("R02 First Garden"))
        XCTAssertTrue(garden.label.contains("Owner"))
        XCTAssertTrue(garden.label.contains("Active"))
        XCTAssertFalse(empty.exists)
        XCTAssertFalse(app.staticTexts["gardens.create.failure"].exists)

        app.terminate()
        app.launchArguments.removeAll { $0 == "--ui-test-reset" }
        app.launch()
        XCTAssertTrue(garden.waitForExistence(timeout: 15))
        XCTAssertTrue(garden.label.contains("R02 First Garden"))
        XCTAssertFalse(empty.exists)
    }
}
